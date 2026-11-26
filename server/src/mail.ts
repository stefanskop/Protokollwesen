import type { FastifyInstance } from 'fastify';
import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import { getServerSetting, setServerSetting, FILES_DIR, db } from './db';
import { authenticate, requireAdmin } from './auth';

interface Smtp {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string; // "Skop Bauconsulting GmbH <office@skop-bauconsulting.at>"
  bccSelf: boolean;
}

// Vorgabe: Internex (SSL/TLS zwingend, Benutzer = vollständige E-Mail-Adresse)
const DEFAULT_SMTP: Smtp = { host: 'mti62028113.secure-node.com', port: 465, secure: true, user: 'office@skop-bauconsulting.at', password: '', from: 'Skop Bauconsulting GmbH <office@skop-bauconsulting.at>', bccSelf: true };

/** Absender immer gültig: „Firma <adresse>“ – leeres Feld → Benutzername des Postfachs */
function sender(s: Smtp) {
  const addr = (/<([^>]+)>/.exec(s.from || '')?.[1] || (/@/.test(s.from || '') ? s.from : '') || s.user || '').trim();
  let name = (s.from || '').replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  if (!name || name.includes('@')) {
    try {
      const row = db.prepare(`SELECT data FROM records WHERE id='settings'`).get() as { data: string } | undefined;
      name = (row && JSON.parse(row.data).companyName) || '';
    } catch {}
  }
  return { addr, from: name ? { name, address: addr } : addr };
}

function transport(s: Smtp) {
  return nodemailer.createTransport({ host: s.host, port: s.port, secure: s.secure, auth: s.user ? { user: s.user, pass: s.password } : undefined });
}

export function mailRoutes(app: FastifyInstance) {
  app.register(async (r) => {
    r.addHook('preHandler', authenticate);

    r.get('/api/admin/smtp', { preHandler: requireAdmin }, async () => {
      const s = getServerSetting<Smtp>('smtp', DEFAULT_SMTP);
      return { ...s, password: s.password ? '********' : '' };
    });

    r.put('/api/admin/smtp', { preHandler: requireAdmin }, async (req) => {
      const cur = getServerSetting<Smtp>('smtp', DEFAULT_SMTP);
      const b = req.body as Partial<Smtp>;
      const next: Smtp = { ...cur, ...b, port: Number(b.port ?? cur.port), password: b.password && b.password !== '********' ? b.password : cur.password };
      setServerSetting('smtp', next);
      return { ok: true };
    });

    r.post('/api/admin/smtp/test', { preHandler: requireAdmin }, async (req, reply) => {
      const s = getServerSetting<Smtp>('smtp', DEFAULT_SMTP);
      try {
        await transport(s).verify();
        const snd = sender(s);
        if (!snd.addr) return reply.code(400).send({ error: 'Absender-Adresse fehlt (Feld „Absender“ bzw. „Benutzername“ ausfüllen)' });
        await transport(s).sendMail({ from: snd.from, to: req.user!.email, subject: 'Projektmanagement – Testnachricht', text: 'Der E-Mail-Versand funktioniert.' });
        return { ok: true };
      } catch (e: any) {
        return reply.code(400).send({ error: e.message });
      }
    });

    r.post('/api/mail/send', { bodyLimit: 40 * 1024 * 1024 }, async (req, reply) => {
      const s = getServerSetting<Smtp>('smtp', DEFAULT_SMTP);
      if (!s.host) return reply.code(400).send({ error: 'E-Mail-Versand ist noch nicht eingerichtet (Einstellungen → E-Mail)' });
      const { to, cc, subject, text, attachments, fileIds } = req.body as {
        to: string[];
        cc?: string[];
        subject: string;
        text: string;
        attachments?: { filename: string; base64: string }[];
        /** Dateien direkt aus der Server-Ablage anhängen (z.B. Pläne) */
        fileIds?: { id: string; filename: string }[];
      };
      const recipients = (to || []).map((x) => String(x).trim()).filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
      if (!recipients.length) return reply.code(400).send({ error: 'Keine gültige Empfängeradresse' });
      const files: { filename: string; path?: string; content?: Buffer }[] = (attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.base64, 'base64') }));
      for (const f of fileIds || []) {
        if (!/^[a-zA-Z0-9-]{8,64}$/.test(f.id)) continue;
        const p = path.join(FILES_DIR, f.id.slice(0, 2), f.id);
        if (!fs.existsSync(p)) return reply.code(409).send({ error: `„${f.filename}“ ist noch nicht auf dem Server – bitte warten, bis „Synchronisiert“ angezeigt wird, und erneut senden.` });
        files.push({ filename: f.filename, path: p });
      }
      const total = files.reduce((n, f) => n + (f.content ? f.content.length : fs.statSync(f.path!).size), 0);
      if (total > 20 * 1024 * 1024)
        return reply.code(413).send({ error: `Anhänge zu groß (${(total / 1048576).toFixed(1)} MB). Die meisten Mailserver nehmen höchstens ca. 20 MB an – bitte weniger Dateien auf einmal senden.` });
      const snd = sender(s);
      const fromAddr = snd.addr;
      if (!fromAddr) return reply.code(400).send({ error: 'Absender-Adresse fehlt – bitte unter Einstellungen → E-Mail-Versand „Absender“ ausfüllen.' });
      try {
        const info = await transport(s).sendMail({
          from: snd.from,
          to: fromAddr, // Empfänger im BCC, damit Adressen nicht offengelegt werden
          bcc: [...recipients, ...(s.bccSelf ? [fromAddr] : [])],
          cc,
          replyTo: req.user!.email,
          subject,
          text,
          attachments: files,
        });
        console.log(`[mail] gesendet an ${recipients.length} Empfänger (${(total / 1048576).toFixed(1)} MB) von ${req.user!.email}`);
        return { ok: true, messageId: info.messageId };
      } catch (e: any) {
        console.error('[mail] Versand fehlgeschlagen:', e.message);
        return reply.code(502).send({ error: 'Versand fehlgeschlagen: ' + e.message });
      }
    });
  });
}
