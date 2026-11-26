// Synchronisation: lokale Änderungen hochladen, Serveränderungen holen, Dateien abgleichen.
import { ldb, getMeta, setMeta, onLocalWrite } from './db';
import { api, ApiError } from './api';
import type { AnyRecord, PullResult, PushResult, FileMeta } from '../../shared/src/index';

export type SyncState = { status: 'idle' | 'syncing' | 'offline' | 'error'; pending: number; lastSync?: string; message?: string };

let state: SyncState = { status: 'idle', pending: 0 };
const listeners = new Set<(s: SyncState) => void>();
export function onSyncState(fn: (s: SyncState) => void) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}
function setState(s: Partial<SyncState>) {
  state = { ...state, ...s };
  listeners.forEach((l) => l(state));
}

let running = false;
let again = false;
let timer: any;

export function scheduleSync(delay = 800) {
  clearTimeout(timer);
  timer = setTimeout(() => void syncNow(), delay);
}

export async function syncNow() {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      setState({ status: 'syncing', pending: await ldb.outbox.count() });
      await push();
      await pull();
      await uploadBlobs();
      setState({ status: 'idle', pending: await ldb.outbox.count(), lastSync: new Date().toISOString(), message: undefined });
    } while (again);
    void prefetchFiles();
  } catch (e: any) {
    const offline = !(e instanceof ApiError);
    setState({ status: offline ? 'offline' : 'error', pending: await ldb.outbox.count(), message: offline ? 'Keine Verbindung zum Server' : e.message });
  } finally {
    running = false;
  }
}

async function push() {
  for (;;) {
    const batch = await ldb.outbox.orderBy('seq').limit(200).toArray();
    if (!batch.length) return;
    const res = await api<PushResult>('/api/sync/push', { body: { mutations: batch.map(({ seq, ...m }) => m) } });
    const done = new Set([...res.applied, ...res.rejected.map((r) => r.mid)]);
    await ldb.outbox.bulkDelete(batch.filter((b) => done.has(b.mid)).map((b) => b.seq!));
    if (res.rejected.length) {
      // Abgelehnte Änderungen: Serverstand wiederherstellen
      const ids = new Set(batch.filter((b) => res.rejected.some((r) => r.mid === b.mid)).map((b) => b.id));
      for (const id of ids) {
        try {
          const rec = await api<AnyRecord>('/api/records/' + id);
          await ldb.records.put(rec);
        } catch {
          await ldb.records.delete(id);
        }
      }
      await addNotices(res.rejected.map((r) => `Änderung abgelehnt: ${r.reason}`));
    }
    if (res.conflicts.length) {
      await addNotices(res.conflicts.map((c) => `Gleichzeitige Änderung an Feld „${c.field}“ – Ihr Stand wurde übernommen, vorheriger Wert: ${short(c.theirs)}`));
    }
    if (done.size === 0) return;
  }
}

const short = (v: unknown) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 80 ? s.slice(0, 80) + '…' : s;
};

export async function addNotices(msgs: string[]) {
  const cur = await getMeta<{ ts: string; msg: string }[]>('notices', []);
  await setMeta('notices', [...cur, ...msgs.map((msg) => ({ ts: new Date().toISOString(), msg }))].slice(-50));
}

async function applyRecords(records: AnyRecord[]) {
  if (!records.length) return;
  await ldb.transaction('rw', ldb.records, ldb.outbox, async () => {
    for (const r of records) {
      const pending = await ldb.outbox.where('id').equals(r.id).toArray();
      let merged: any = r;
      // noch nicht hochgeladene lokale Änderungen bleiben erhalten
      for (const p of pending) merged = { ...merged, ...p.set };
      await ldb.records.put(merged);
    }
  });
}

async function pull() {
  let since = await getMeta<number>('rev', 0);
  let projectIds: string[] = [];
  for (;;) {
    const res = await api<PullResult>('/api/sync/pull?since=' + since);
    await applyRecords(res.records);
    since = res.rev;
    await setMeta('rev', since);
    projectIds = res.projectIds;
    if (!res.more) break;
  }
  // neu freigegebene Projekte vollständig laden, entzogene lokal entfernen
  const known = new Set(await getMeta<string[]>('projects', []));
  const now = new Set(projectIds);
  for (const pid of projectIds) {
    if (known.has(pid)) continue;
    let s = 0;
    for (;;) {
      const res = await api<PullResult>(`/api/sync/pull?project=${pid}&since=${s}`);
      await applyRecords(res.records);
      s = res.rev;
      if (!res.more) break;
    }
  }
  for (const pid of known) if (!now.has(pid)) await ldb.records.where('projectId').equals(pid).delete();
  await setMeta('projects', projectIds);
}

async function uploadBlobs() {
  const pending = await ldb.blobs.filter((b) => !b.uploaded).toArray();
  for (const b of pending) {
    await api('/api/files/' + b.id, { method: 'PUT', raw: b.blob, contentType: b.blob.type || 'application/octet-stream' });
    await ldb.blobs.update(b.id, { uploaded: true });
  }
}

let prefetching = false;
/** Bilder der aktiven Projekte vorab laden, damit sie offline verfügbar sind */
async function prefetchFiles() {
  if (prefetching) return;
  prefetching = true;
  try {
    const archived = new Set((await ldb.records.where('type').equals('project').toArray()).filter((p: any) => p.archived).map((p) => p.id));
    const files = (await ldb.records.where('type').equals('file').toArray()) as FileMeta[];
    for (const f of files) {
      if (f.deleted || (f.projectId && archived.has(f.projectId))) continue;
      if (!f.mime?.startsWith('image/')) continue;
      if (await ldb.blobs.get(f.id)) continue;
      try {
        const blob = await api<Blob>('/api/files/' + f.id);
        await ldb.blobs.put({ id: f.id, blob, uploaded: true });
      } catch {
        /* später erneut */
      }
    }
  } finally {
    prefetching = false;
  }
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const b = await ldb.blobs.get(id);
  if (b) return b.blob;
  try {
    const blob = await api<Blob>('/api/files/' + id);
    await ldb.blobs.put({ id, blob, uploaded: true });
    return blob;
  } catch {
    return undefined;
  }
}

export function startSyncLoop() {
  onLocalWrite(() => scheduleSync(600));
  window.addEventListener('online', () => scheduleSync(100));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleSync(100);
  });
  setInterval(() => scheduleSync(0), 60_000);
  scheduleSync(0);
}
