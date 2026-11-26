// Gemeinsame Firmen & Kontakte – auch für die Kostenverfolgung
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { db } from './db';
import { authenticate } from './auth';
import { applyMutations } from './sync';

const norm = (s: string) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function companies() {
  return (db.prepare(`SELECT data FROM records WHERE type='company' AND deleted=0`).all() as { data: string }[]).map((r) => JSON.parse(r.data));
}

export function companyRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', authenticate);

    /** Firmen inkl. Kontakte (für Auswahl in der Kostenverfolgung) */
    r.get('/api/companies', async () => {
      const contacts = (db.prepare(`SELECT data FROM records WHERE type='contact' AND deleted=0`).all() as { data: string }[]).map((r) => JSON.parse(r.data));
      return {
        items: companies()
          .map((c) => ({
            id: c.id,
            name: c.name,
            address: c.address || '',
            uid: c.uid || '',
            phone: c.phone || '',
            email: c.email || '',
            contacts: contacts
              .filter((k) => k.companyId === c.id)
              .map((k) => ({ name: [k.title, k.firstName, k.lastName].filter(Boolean).join(' '), function: k.function || '', phone: k.phone || '', email: k.email || '' })),
          }))
          .sort((a, b) => a.name.localeCompare(b.name, 'de')),
      };
    });

    /** Firmen anlegen, falls noch nicht vorhanden; fehlende Adresse/UID ergänzen */
    r.post('/api/companies/ensure', async (req) => {
      const { items } = (req.body || {}) as { items: { name: string; address?: string; uid?: string }[] };
      const existing = companies();
      const muts: any[] = [];
      let created = 0;
      let updated = 0;
      for (const it of (items || []).slice(0, 500)) {
        const name = String(it.name || '').trim();
        if (!name || /^projektteam$/i.test(name)) continue;
        const ex = existing.find((c) => norm(c.name) === norm(name));
        const now = new Date().toISOString();
        if (!ex) {
          const id = crypto.randomUUID();
          const set = { name, address: it.address || '', uid: it.uid || '' };
          muts.push({ mid: crypto.randomUUID(), id, type: 'company', baseRev: 0, set: { ...set, createdAt: now }, ts: now });
          existing.push({ id, ...set });
          created++;
        } else {
          const set: any = {};
          if (it.address && !ex.address) set.address = it.address;
          if (it.uid && !ex.uid) set.uid = it.uid;
          if (Object.keys(set).length) {
            const row = db.prepare(`SELECT rev FROM records WHERE id=?`).get(ex.id) as { rev: number };
            muts.push({ mid: crypto.randomUUID(), id: ex.id, type: 'company', baseRev: row?.rev || 0, set, ts: now });
            Object.assign(ex, set);
            updated++;
          }
        }
      }
      if (muts.length) applyMutations(req.user!, req.device, muts);
      return { created, updated };
    });
  });
}
