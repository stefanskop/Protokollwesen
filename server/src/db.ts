import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const FILES_DIR = path.join(DATA_DIR, 'files');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(BACKUP_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'protokollwesen.db'));
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');

// Versionierte Datenbank-Umstellungen. NIE bestehende Schritte ändern – nur neue anhängen.
const MIGRATIONS: string[] = [
  // 1: Grundgerüst
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'mitarbeiter',
    pw_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE tokens (
    hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device TEXT,
    created_at TEXT NOT NULL,
    last_seen TEXT,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE records (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    project_id TEXT,
    data TEXT NOT NULL,
    rev INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    updated_by TEXT
  );
  CREATE INDEX records_rev ON records(rev);
  CREATE INDEX records_project ON records(project_id);
  CREATE TABLE changes (
    rev INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id TEXT NOT NULL,
    fields TEXT NOT NULL,
    user_id TEXT,
    device TEXT,
    ts TEXT NOT NULL
  );
  CREATE INDEX changes_record ON changes(record_id, rev);
  CREATE TABLE mutations (mid TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE server_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `,
  // 2: Kostenverfolgung Hochbau (ganze Projekte als JSON-Dokument, mit Versionsnummer)
  `
  CREATE TABLE kosten (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    data TEXT NOT NULL,
    rev INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    owner TEXT,
    access TEXT NOT NULL DEFAULT '[]',
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE kosten_history (
    id TEXT NOT NULL,
    rev INTEGER NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT,
    PRIMARY KEY (id, rev)
  );
  `,
];

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const row = db.prepare(`SELECT value FROM meta WHERE key='schema'`).get() as { value: string } | undefined;
  let v = row ? parseInt(row.value, 10) : 0;
  while (v < MIGRATIONS.length) {
    const sql = MIGRATIONS[v];
    db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO meta(key,value) VALUES('schema',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(v + 1));
    })();
    v++;
    console.log(`[db] Umstellung auf Schema ${v} durchgeführt`);
  }
}

export function getServerSetting<T>(key: string, fallback: T): T {
  const r = db.prepare(`SELECT value FROM server_settings WHERE key=?`).get(key) as { value: string } | undefined;
  return r ? (JSON.parse(r.value) as T) : fallback;
}
export function setServerSetting(key: string, value: unknown) {
  db.prepare(`INSERT INTO server_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, JSON.stringify(value));
}

/** Tägliche Sicherung der Datenbank (zusätzlich zu Hyper Backup der NAS), 14 Stände */
export function scheduleBackups() {
  const run = () => {
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const target = path.join(BACKUP_DIR, `protokollwesen-${stamp}.db`);
      if (!fs.existsSync(target)) {
        db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
        console.log(`[backup] ${target}`);
      }
      const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort();
      for (const f of files.slice(0, Math.max(0, files.length - 14))) fs.unlinkSync(path.join(BACKUP_DIR, f));
    } catch (e) {
      console.error('[backup] fehlgeschlagen', e);
    }
  };
  setTimeout(run, 60_000);
  setInterval(run, 6 * 3600_000);
}

// Umstellungen sofort beim Laden ausführen (vor allen vorbereiteten Abfragen)
migrate();
