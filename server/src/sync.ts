import type { FastifyInstance } from 'fastify';
import { db } from './db';
import { authenticate, type AuthUser } from './auth';
import { DEFAULT_SETTINGS, type Mutation, type PushResult, type PullResult } from '../../shared/src/index';

const GLOBAL_TYPES = new Set(['settings', 'company', 'contact']);
const PROJECT_TYPES = new Set(['project', 'protocol', 'item', 'entry', 'file']);

interface Row {
  id: string;
  type: string;
  project_id: string | null;
  data: string;
  rev: number;
  deleted: number;
}

const getRow = db.prepare(`SELECT * FROM records WHERE id=?`);

/** Projekte, auf die ein Benutzer Zugriff hat */
export function accessibleProjects(user: AuthUser): Set<string> {
  const rows = db.prepare(`SELECT id, data, deleted FROM records WHERE type='project'`).all() as Row[];
  const s = new Set<string>();
  for (const r of rows) {
    if (user.role === 'admin') {
      s.add(r.id);
      continue;
    }
    const d = JSON.parse(r.data);
    if ((d.memberUserIds || []).includes(user.id) || d.createdBy === user.id) s.add(r.id);
  }
  return s;
}

export function canSee(user: AuthUser, r: { type: string; project_id: string | null }, projects: Set<string>) {
  if (GLOBAL_TYPES.has(r.type)) return true;
  if (!r.project_id) return user.role === 'admin' || r.type === 'file';
  return projects.has(r.project_id);
}

export function ensureSettings() {
  if (!getRow.get('settings')) {
    const now = new Date().toISOString();
    const data = { ...DEFAULT_SETTINGS, id: 'settings', type: 'settings', createdAt: now };
    const info = db.prepare(`INSERT INTO changes(record_id,fields,user_id,ts) VALUES(?,?,?,?)`).run('settings', JSON.stringify(Object.keys(data)), null, now);
    db.prepare(`INSERT INTO records(id,type,project_id,data,rev,deleted,updated_at) VALUES(?,?,?,?,?,0,?)`).run('settings', 'settings', null, JSON.stringify(data), info.lastInsertRowid, now);
  }
}

function validate(user: AuthUser, m: Mutation, existing: Row | undefined, projects: Set<string>): string | null {
  if (!GLOBAL_TYPES.has(m.type) && !PROJECT_TYPES.has(m.type)) return 'Unbekannter Typ';
  if (existing && existing.type !== m.type) return 'Typ passt nicht';
  if (m.type === 'settings' && user.role !== 'admin') return 'Einstellungen nur durch Administrator';
  if (m.type === 'project') {
    if (existing && !projects.has(existing.id)) return 'Kein Zugriff auf Projekt';
    return null;
  }
  if (PROJECT_TYPES.has(m.type) && m.type !== 'file') {
    const pid = existing?.project_id ?? m.projectId;
    if (!pid || !projects.has(pid)) return 'Kein Zugriff auf Projekt';
  }
  // Sperre: abgeschlossene fortlaufende Protokolle
  if (m.type === 'entry') {
    const data = existing ? { ...JSON.parse(existing.data), ...m.set } : m.set;
    const protoIds = new Set([data.protocolId, existing && JSON.parse(existing.data).protocolId].filter(Boolean));
    for (const pid of protoIds) {
      const p = getRow.get(pid) as Row | undefined;
      if (p) {
        const pd = JSON.parse(p.data);
        if (pd.mode === 'fortlaufend' && pd.status === 'abgeschlossen') return 'Protokoll ist abgeschlossen – Eintrag gesperrt';
      }
    }
  }
  if (m.type === 'protocol' && existing) {
    const pd = JSON.parse(existing.data);
    if (pd.status === 'abgeschlossen' && m.set.status === 'entwurf' && pd.mode === 'fortlaufend' && user.role !== 'admin')
      return 'Freischalten nur durch Administrator';
  }
  return null;
}

export function applyMutations(user: AuthUser, device: string | undefined, muts: Mutation[]): PushResult {
  const res: PushResult = { applied: [], rejected: [], conflicts: [] };
  const seen = db.prepare(`SELECT 1 FROM mutations WHERE mid=?`);
  const changedSince = db.prepare(`SELECT fields, device FROM changes WHERE record_id=? AND rev>?`);
  const insChange = db.prepare(`INSERT INTO changes(record_id,fields,user_id,device,ts) VALUES(?,?,?,?,?)`);
  const upsert = db.prepare(
    `INSERT INTO records(id,type,project_id,data,rev,deleted,updated_at,updated_by) VALUES(@id,@type,@project_id,@data,@rev,@deleted,@updated_at,@updated_by)
     ON CONFLICT(id) DO UPDATE SET data=excluded.data, rev=excluded.rev, deleted=excluded.deleted, updated_at=excluded.updated_at, updated_by=excluded.updated_by, project_id=excluded.project_id`,
  );
  const insMut = db.prepare(`INSERT INTO mutations(mid,applied_at) VALUES(?,?)`);

  db.transaction(() => {
    let projects = accessibleProjects(user);
    for (const m of muts) {
      if (seen.get(m.mid)) {
        res.applied.push(m.mid);
        continue;
      }
      const existing = getRow.get(m.id) as Row | undefined;
      const err = validate(user, m, existing, projects);
      if (err) {
        res.rejected.push({ mid: m.mid, reason: err });
        insMut.run(m.mid, new Date().toISOString());
        continue;
      }
      const cur = existing ? JSON.parse(existing.data) : {};
      // Konflikterkennung: Felder, die seit baseRev von jemand anderem geändert wurden
      if (existing && m.baseRev < existing.rev) {
        const others = new Set<string>();
        for (const c of changedSince.all(m.id, m.baseRev) as any[]) {
          if (c.device && c.device === device) continue; // eigene Änderungen dieses Geräts
          for (const f of JSON.parse(c.fields)) others.add(f);
        }
        for (const [k, v] of Object.entries(m.set)) {
          if (others.has(k) && JSON.stringify(cur[k]) !== JSON.stringify(v) && !k.startsWith('updated'))
            res.conflicts.push({ id: m.id, field: k, theirs: cur[k], mine: v });
        }
      }
      const now = new Date().toISOString();
      const set = { ...m.set };
      delete (set as any).rev;
      const data = { ...cur, ...set, id: m.id, type: m.type, updatedAt: now, updatedBy: user.id };
      if (!existing) {
        data.createdAt = data.createdAt || now;
        data.createdBy = data.createdBy || user.id;
      }
      if (m.type === 'project') {
        data.projectId = m.id;
        if (!existing && !(data.memberUserIds || []).includes(user.id)) data.memberUserIds = [...(data.memberUserIds || []), user.id];
      }
      const projectId = m.type === 'project' ? m.id : (data.projectId ?? null);
      const info = insChange.run(m.id, JSON.stringify(Object.keys(set)), user.id, device || null, now);
      upsert.run({
        id: m.id,
        type: m.type,
        project_id: projectId,
        data: JSON.stringify(data),
        rev: info.lastInsertRowid,
        deleted: data.deleted ? 1 : 0,
        updated_at: now,
        updated_by: user.id,
      });
      insMut.run(m.mid, now);
      res.applied.push(m.mid);
      if (m.type === 'project') projects = accessibleProjects(user);
    }
  })();
  return res;
}

export function syncRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', authenticate);

    r.post('/api/sync/push', { bodyLimit: 20 * 1024 * 1024 }, async (req) => {
      const { mutations } = req.body as { mutations: Mutation[] };
      return applyMutations(req.user!, req.device, mutations || []);
    });

    r.get('/api/sync/pull', async (req): Promise<PullResult> => {
      const q = req.query as { since?: string; project?: string };
      const since = parseInt(q.since || '0', 10) || 0;
      const projects = accessibleProjects(req.user!);
      const LIMIT = 1000;
      let rows: Row[];
      if (q.project) {
        // Vollabgleich eines neu freigegebenen Projekts
        if (!projects.has(q.project)) rows = [];
        else rows = db.prepare(`SELECT * FROM records WHERE project_id=? AND rev>? ORDER BY rev LIMIT ?`).all(q.project, since, LIMIT) as Row[];
      } else {
        rows = db.prepare(`SELECT * FROM records WHERE rev>? ORDER BY rev LIMIT ?`).all(since, LIMIT) as Row[];
      }
      const maxRev = rows.length ? rows[rows.length - 1].rev : since;
      const records = rows.filter((x) => canSee(req.user!, x, projects)).map((x) => ({ ...JSON.parse(x.data), rev: x.rev }));
      return { records, rev: maxRev, more: rows.length === LIMIT, projectIds: [...projects] };
    });

    // Einzelnen Datensatz neu laden (z.B. nach abgelehnter Änderung)
    r.get('/api/records/:id', async (req, reply) => {
      const row = getRow.get((req.params as any).id) as Row | undefined;
      if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
      if (!canSee(req.user!, row, accessibleProjects(req.user!))) return reply.code(403).send({ error: 'Kein Zugriff' });
      return { ...JSON.parse(row.data), rev: row.rev };
    });

    // Änderungsverlauf eines Datensatzes (wer hat wann was geändert)
    r.get('/api/history/:id', async (req) => {
      const { id } = req.params as any;
      return db
        .prepare(`SELECT c.rev, c.fields, c.ts, c.device, u.name FROM changes c LEFT JOIN users u ON u.id=c.user_id WHERE record_id=? ORDER BY rev DESC LIMIT 200`)
        .all(id);
    });
  });
}
