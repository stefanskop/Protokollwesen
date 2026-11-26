import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { db, FILES_DIR } from './db';
import { authenticate } from './auth';
import { accessibleProjects, canSee } from './sync';

const SAFE = /^[a-zA-Z0-9-]{8,64}$/;
const filePath = (id: string) => path.join(FILES_DIR, id.slice(0, 2), id);

export function fileRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', authenticate);
    r.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: 60 * 1024 * 1024 }, (_req, body, done) => done(null, body));

    r.put('/api/files/:id', async (req, reply) => {
      const { id } = req.params as any;
      if (!SAFE.test(id)) return reply.code(400).send({ error: 'Ungültige ID' });
      const p = filePath(id);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      if (fs.existsSync(p)) return { ok: true, existed: true }; // Dateien sind unveränderlich
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, req.body as Buffer);
      fs.renameSync(tmp, p);
      return { ok: true };
    });

    r.get('/api/files/:id', async (req, reply) => {
      const { id } = req.params as any;
      if (!SAFE.test(id)) return reply.code(400).send({ error: 'Ungültige ID' });
      const rec = db.prepare(`SELECT type, project_id, data FROM records WHERE id=?`).get(id) as any;
      if (rec && !canSee(req.user!, rec, accessibleProjects(req.user!))) return reply.code(403).send({ error: 'Kein Zugriff' });
      const p = filePath(id);
      if (!fs.existsSync(p)) return reply.code(404).send({ error: 'Datei fehlt' });
      const mime = rec ? JSON.parse(rec.data).mime : 'application/octet-stream';
      reply.header('Content-Type', mime || 'application/octet-stream');
      reply.header('Cache-Control', 'private, max-age=31536000, immutable');
      return reply.send(fs.createReadStream(p));
    });

  });
}
