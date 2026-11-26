import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { db } from './db';
import type { UserInfo } from '../../shared/src/index';

const TOKEN_DAYS = 180;

export interface AuthUser extends UserInfo {}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    device?: string;
  }
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

function rowToUser(r: any): AuthUser {
  return { id: r.id, email: r.email, name: r.name, role: r.role, active: !!r.active };
}

export function ensureAdmin() {
  const count = (db.prepare(`SELECT COUNT(*) c FROM users`).get() as any).c as number;
  if (count > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@skop-bauconsulting.at';
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare(`INSERT INTO users(id,email,name,role,pw_hash,active,created_at) VALUES(?,?,?,?,?,1,?)`).run(
    crypto.randomUUID(),
    email,
    process.env.ADMIN_NAME || 'Administrator',
    'admin',
    bcrypt.hashSync(password, 10),
    new Date().toISOString(),
  );
  console.log(`[auth] Erster Administrator angelegt: ${email}` + (process.env.ADMIN_PASSWORD ? '' : `  Passwort: ${password}`));
}

const attempts = new Map<string, { n: number; until: number }>();

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.query as any)?.token;
  if (!token) return reply.code(401).send({ error: 'Nicht angemeldet' });
  const row = db
    .prepare(`SELECT u.*, t.device, t.expires_at FROM tokens t JOIN users u ON u.id=t.user_id WHERE t.hash=?`)
    .get(sha(String(token))) as any;
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return reply.code(401).send({ error: 'Sitzung abgelaufen' });
  req.user = rowToUser(row);
  // eindeutige Kennung dieser Geräte-Anmeldung (für Konflikterkennung)
  req.device = sha(String(token)).slice(0, 16);
  db.prepare(`UPDATE tokens SET last_seen=? WHERE hash=?`).run(new Date().toISOString(), sha(String(token)));
}

export function requireAdmin(req: FastifyRequest, reply: FastifyReply, done: () => void) {
  if (req.user?.role !== 'admin') {
    reply.code(403).send({ error: 'Nur für Administratoren' });
    return;
  }
  done();
}

export function authRoutes(app: FastifyInstance) {
  app.post('/api/login', async (req, reply) => {
    const { email, password, device } = (req.body || {}) as any;
    const key = req.ip + '|' + String(email).toLowerCase();
    const a = attempts.get(key);
    if (a && a.n >= 5 && a.until > Date.now()) return reply.code(429).send({ error: 'Zu viele Versuche – bitte 5 Minuten warten' });
    const row = db.prepare(`SELECT * FROM users WHERE email=?`).get(String(email || '')) as any;
    if (!row || !row.active || !bcrypt.compareSync(String(password || ''), row.pw_hash)) {
      attempts.set(key, { n: (a?.n || 0) + 1, until: Date.now() + 5 * 60_000 });
      return reply.code(401).send({ error: 'E-Mail oder Passwort falsch' });
    }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    db.prepare(`INSERT INTO tokens(hash,user_id,device,created_at,last_seen,expires_at) VALUES(?,?,?,?,?,?)`).run(
      sha(token),
      row.id,
      String(device || 'Gerät').slice(0, 80),
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + TOKEN_DAYS * 86400_000).toISOString(),
    );
    return { token, user: rowToUser(row) };
  });

  app.register(async (r) => {
    r.addHook('preHandler', authenticate);

    r.get('/api/me', async (req) => ({ user: req.user }));

    r.post('/api/logout', async (req) => {
      const token = (req.headers.authorization || '').slice(7);
      db.prepare(`DELETE FROM tokens WHERE hash=?`).run(sha(token));
      return { ok: true };
    });

    r.post('/api/me/password', async (req, reply) => {
      const { oldPassword, newPassword } = req.body as any;
      const row = db.prepare(`SELECT pw_hash FROM users WHERE id=?`).get(req.user!.id) as any;
      if (!bcrypt.compareSync(String(oldPassword || ''), row.pw_hash)) return reply.code(400).send({ error: 'Altes Passwort falsch' });
      if (String(newPassword || '').length < 8) return reply.code(400).send({ error: 'Mindestens 8 Zeichen' });
      db.prepare(`UPDATE users SET pw_hash=? WHERE id=?`).run(bcrypt.hashSync(newPassword, 10), req.user!.id);
      return { ok: true };
    });

    // Benutzerliste (für Anzeige von Namen; alle angemeldeten Benutzer)
    r.get('/api/users', async () => (db.prepare(`SELECT * FROM users ORDER BY name`).all() as any[]).map(rowToUser));

    r.post('/api/users', { preHandler: requireAdmin }, async (req, reply) => {
      const { email, name, role, password } = req.body as any;
      if (!email || !name || String(password || '').length < 8) return reply.code(400).send({ error: 'E-Mail, Name und Passwort (min. 8 Zeichen) erforderlich' });
      const id = crypto.randomUUID();
      try {
        db.prepare(`INSERT INTO users(id,email,name,role,pw_hash,active,created_at) VALUES(?,?,?,?,?,1,?)`).run(
          id,
          email,
          name,
          role === 'admin' ? 'admin' : 'mitarbeiter',
          bcrypt.hashSync(password, 10),
          new Date().toISOString(),
        );
      } catch {
        return reply.code(400).send({ error: 'E-Mail bereits vergeben' });
      }
      return { id };
    });

    r.patch('/api/users/:id', { preHandler: requireAdmin }, async (req, reply) => {
      const { id } = req.params as any;
      const { name, role, active, password } = req.body as any;
      if (id === req.user!.id && (active === false || role === 'mitarbeiter')) return reply.code(400).send({ error: 'Eigenes Konto kann nicht deaktiviert/herabgestuft werden' });
      if (name !== undefined) db.prepare(`UPDATE users SET name=? WHERE id=?`).run(name, id);
      if (role !== undefined) db.prepare(`UPDATE users SET role=? WHERE id=?`).run(role === 'admin' ? 'admin' : 'mitarbeiter', id);
      if (active !== undefined) {
        db.prepare(`UPDATE users SET active=? WHERE id=?`).run(active ? 1 : 0, id);
        if (!active) db.prepare(`DELETE FROM tokens WHERE user_id=?`).run(id);
      }
      if (password) {
        if (String(password).length < 8) return reply.code(400).send({ error: 'Mindestens 8 Zeichen' });
        db.prepare(`UPDATE users SET pw_hash=? WHERE id=?`).run(bcrypt.hashSync(password, 10), id);
      }
      return { ok: true };
    });
  });
}
