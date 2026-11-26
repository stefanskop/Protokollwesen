import type { FastifyInstance } from 'fastify';
import nodemailer from 'nodemailer';
import { getServerSetting, setServerSetting } from './db';
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
        await transport(s).sendMail({ from: s.from, to: req.user!.email, subject: 'Projektmanagement – Testnachricht', text: 'Der E-Mail-Versand funktioniert.' });
        return { ok: true };
      } catch (e: any) {
        return reply.code(400).send({ error: e.message });
      }
    });

    r.post('/api/mail/send', { bodyLimit: 40 * 1024 * 1024 }, async (req, reply) => {
      const s = getServerSetting<Smtp>('smtp', DEFAULT_SMTP);
      if (!s.host) return reply.code(400).send({ error: 'E-Mail-Versand ist noch nicht eingerichtet (Einstellungen → E-Mail)' });
      const { to, cc, subject, text, attachments } = req.body as { to: string[]; cc?: string[]; subject: string; text: string; attachments: { filename: string; base64: string }[] };
      if (!to?.length) return reply.code(400).send({ error: 'Keine Empfänger' });
      const fromAddr = /<([^>]+)>/.exec(s.from)?.[1] || s.from;
      try {
        const info = await transport(s).sendMail({
          from: s.from,
          to: fromAddr, // Empfänger im BCC, damit Adressen nicht offengelegt werden
          bcc: [...to, ...(s.bccSelf ? [fromAddr] : [])],
          cc,
          replyTo: req.user!.email,
          subject,
          text,
          attachments: (attachments || []).map((a) => ({ filename: a.filename, content: Buffer.from(a.base64, 'base64') })),
        });
        return { ok: true, messageId: info.messageId };
      } catch (e: any) {
        return reply.code(502).send({ error: 'Versand fehlgeschlagen: ' + e.message });
      }
    });
  });
}
