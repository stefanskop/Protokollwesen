/**
 * Kostenverfolgung Hochbau – Ablage auf dem Server.
 *
 * Die Kostenverfolgung ist eine eigenständige Web-App (kosten/Kostenverfolgung.html), die
 * ihre Projekte als ganze JSON-Dokumente verwaltet. Der Server speichert je Projekt den
 * letzten Stand mit Versionsnummer (rev). Gespeichert wird nur, wenn das Gerät den
 * aktuellen Stand kannte (baseRev) – sonst meldet der Server einen Konflikt (409) und
 * das Gerät entscheidet mit dem Benutzer, welcher Stand gilt.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db, FILES_DIR } from './db';
import { authenticate, type AuthUser } from './auth';

const KEEP_VERSIONS = 5;
const SAFE_ID = /^[a-zA-Z0-9_-]{4,80}$/;
const KFILES = path.join(FILES_DIR, 'kosten');
const kfile = (id: string) => path.join(KFILES, id.slice(0, 2), id);

interface KRow {
  id: string;
  kind: string;
  data: string;
  rev: number;
  deleted: number;
  owner: string | null;
  access: string;
  updated_at: string;
  updated_by: string | null;
  created_at: string;
}

const getRow = db.prepare(`SELECT * FROM kosten WHERE id=?`);

function canSee(user: AuthUser, r: KRow) {
  if (r.kind !== 'project') return true;
  if (user.role === 'admin') return true;
  if (r.owner === user.id) return true;
  try {
    return (JSON.parse(r.access || '[]') as string[]).includes(user.id);
  } catch {
    return false;
  }
}

function summary(r: KRow) {
  let projNr = '';
  let projekt = '';
  if (r.kind === 'project' && !r.deleted) {
    try {
      const m = JSON.parse(r.data).meta || {};
      projNr = m.projNr || '';
      projekt = m.projekt || '';
    } catch {}
  }
  return {
    id: r.id,
    kind: r.kind,
    rev: r.rev,
    deleted: !!r.deleted,
    owner: r.owner,
    access: JSON.parse(r.access || '[]'),
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    projNr,
    projekt,
  };
}

function userName(req: FastifyRequest) {
  return req.user?.name || req.user?.email || '';
}

const saveHistory = db.prepare(`INSERT INTO kosten_history(id,rev,data,updated_at,updated_by) VALUES(?,?,?,?,?)`);
const pruneHistory = db.prepare(
  `DELETE FROM kosten_history WHERE id=? AND rev NOT IN (SELECT rev FROM kosten_history WHERE id=? ORDER BY rev DESC LIMIT ${KEEP_VERSIONS})`,
);

/** Speichert einen Stand, wenn baseRev zum Server passt. Liefert die neue rev oder einen Konflikt. */
const write = db.transaction(
  (id: string, kind: string, data: string | null, baseRev: number, user: AuthUser, name: string): { rev: number } | { conflict: KRow } => {
    const cur = getRow.get(id) as KRow | undefined;
    // Unbekannt am Server (z. B. nach Wiederherstellung einer Sicherung) → einfach anlegen
    if (cur && cur.rev !== baseRev) return { conflict: cur };
    const now = new Date().toISOString();
    const rev = (cur?.rev || 0) + 1;
    if (cur) {
      // Vorherigen Stand aufheben (Schutz gegen versehentliches Überschreiben)
      if (!cur.deleted) {
        saveHistory.run(id, cur.rev, cur.data, cur.updated_at, cur.updated_by);
        pruneHistory.run(id, id);
      }
      db.prepare(`UPDATE kosten SET data=?, rev=?, deleted=?, updated_at=?, updated_by=? WHERE id=?`).run(
        data ?? cur.data,
        rev,
        data === null ? 1 : 0,
        now,
        name,
        id,
      );
    } else {
      if (data === null) return { rev: 0 };
      db.prepare(
        `INSERT INTO kosten(id,kind,data,rev,deleted,owner,access,updated_at,updated_by,created_at) VALUES(?,?,?,?,0,?,'[]',?,?,?)`,
      ).run(id, kind, data, rev, user.id, now, name, now);
    }
    return { rev };
  },
);

export function kostenRoutes(app: FastifyInstance) {
  fs.mkdirSync(KFILES, { recursive: true });

  app.register(async (r) => {
    r.addHook('preHandler', authenticate);
    r.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) =>
      done(null, body),
    );

    /** Übersicht: welche Projekte gibt es in welchem Stand */
    r.get('/api/kosten/list', async (req) => {
      const rows = db.prepare(`SELECT * FROM kosten`).all() as KRow[];
      return { items: rows.filter((x) => canSee(req.user!, x)).map(summary) };
    });

    r.get('/api/kosten/doc/:id', async (req, reply) => {
      const { id } = req.params as any;
      const row = getRow.get(id) as KRow | undefined;
      if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
      if (!canSee(req.user!, row)) return reply.code(403).send({ error: 'Kein Zugriff' });
      return { ...summary(row), data: row.deleted ? null : JSON.parse(row.data) };
    });

    /** Stand speichern (data = null → löschen). Konflikt → 409 mit dem Server-Stand (ohne Daten). */
    r.put('/api/kosten/doc/:id', { bodyLimit: 80 * 1024 * 1024 }, async (req, reply) => {
      const { id } = req.params as any;
      const { kind, data, baseRev } = (req.body || {}) as any;
      if (!SAFE_ID.test(id)) return reply.code(400).send({ error: 'Ungültige ID' });
      const k = kind === 'buero' ? 'buero' : 'project';
      if (k === 'buero' && id !== 'buero') return reply.code(400).send({ error: 'Ungültige ID' });
      const cur = getRow.get(id) as KRow | undefined;
      if (cur && !canSee(req.user!, cur)) return reply.code(403).send({ error: 'Kein Zugriff' });
      if (data === null && cur && k === 'project' && req.user!.role !== 'admin' && cur.owner !== req.user!.id)
        return reply.code(403).send({ error: 'Löschen nur durch Ersteller oder Administrator' });
      const res = write(id, k, data === null ? null : JSON.stringify(data), Number(baseRev) || 0, req.user!, userName(req));
      if ('conflict' in res) return reply.code(409).send({ error: 'Zwischenzeitlich geändert', current: summary(res.conflict) });
      return { rev: res.rev };
    });

    /** Freigabe eines Projekts für Mitarbeiter (nur Administrator oder Ersteller) */
    r.put('/api/kosten/access/:id', async (req, reply) => {
      const { id } = req.params as any;
      const { access } = (req.body || {}) as any;
      const cur = getRow.get(id) as KRow | undefined;
      if (!cur || cur.kind !== 'project') return reply.code(404).send({ error: 'Nicht gefunden' });
      if (req.user!.role !== 'admin' && cur.owner !== req.user!.id) return reply.code(403).send({ error: 'Nur Administrator oder Ersteller' });
      const list = Array.isArray(access) ? access.map(String).slice(0, 200) : [];
      db.prepare(`UPDATE kosten SET access=? WHERE id=?`).run(JSON.stringify(list), id);
      return { ok: true };
    });

    /** Frühere Stände eines Projekts (die letzten fünf) */
    r.get('/api/kosten/history/:id', async (req, reply) => {
      const { id } = req.params as any;
      const cur = getRow.get(id) as KRow | undefined;
      if (!cur || !canSee(req.user!, cur)) return reply.code(404).send({ error: 'Nicht gefunden' });
      const rows = db.prepare(`SELECT rev, updated_at, updated_by FROM kosten_history WHERE id=? ORDER BY rev DESC`).all(id);
      return { items: rows };
    });

    r.get('/api/kosten/history/:id/:rev', async (req, reply) => {
      const { id, rev } = req.params as any;
      const cur = getRow.get(id) as KRow | undefined;
      if (!cur || !canSee(req.user!, cur)) return reply.code(404).send({ error: 'Nicht gefunden' });
      const row = db.prepare(`SELECT data FROM kosten_history WHERE id=? AND rev=?`).get(id, Number(rev)) as any;
      if (!row) return reply.code(404).send({ error: 'Nicht gefunden' });
      return JSON.parse(row.data);
    });

    /** Originalrechnungen (PDF) der Rechnungsprüfung – unveränderlich je ID */
    r.put('/api/kosten/files/:id', async (req, reply) => {
      const { id } = req.params as any;
      if (!SAFE_ID.test(id)) return reply.code(400).send({ error: 'Ungültige ID' });
      const p = kfile(id);
      if (fs.existsSync(p)) return { ok: true, existed: true };
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p + '.tmp', req.body as Buffer);
      fs.renameSync(p + '.tmp', p);
      return { ok: true };
    });

    r.get('/api/kosten/files/:id', async (req, reply) => {
      const { id } = req.params as any;
      if (!SAFE_ID.test(id)) return reply.code(400).send({ error: 'Ungültige ID' });
      const p = kfile(id);
      if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Datei fehlt' });
      reply.header('Content-Type', 'application/pdf');
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      return reply.send(fs.createReadStream(p));
    });
  });
}
