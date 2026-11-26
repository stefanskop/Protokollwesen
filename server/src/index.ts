import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { scheduleBackups } from './db';
import { authRoutes, ensureAdmin } from './auth';
import { syncRoutes, ensureSettings } from './sync';
import { fileRoutes } from './files';
import { mailRoutes } from './mail';


ensureAdmin();
ensureSettings();
scheduleBackups();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn' }, bodyLimit: 10 * 1024 * 1024, trustProxy: true });

app.get('/api/health', async () => ({ ok: true, version: process.env.APP_VERSION || 'dev', time: new Date().toISOString() }));
authRoutes(app);
syncRoutes(app);
fileRoutes(app);
mailRoutes(app);

// Web-App ausliefern
const here = path.dirname(fileURLToPath(import.meta.url));
const clientDir = [process.env.CLIENT_DIR, path.resolve(here, '../../client/dist'), path.resolve(here, '../client')].find((d) => d && fs.existsSync(d));
if (clientDir) {
  app.register(fastifyStatic, {
    root: clientDir,
    setHeaders: (res, p) => {
      if (p.endsWith('index.html') || p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache');
    },
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    return reply.sendFile('index.html');
  });
}

const port = parseInt(process.env.PORT || '8080', 10);
app.listen({ port, host: '0.0.0.0' }).then(() => console.log(`Protokollwesen läuft auf Port ${port}`));
