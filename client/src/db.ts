import Dexie, { type Table } from 'dexie';
import type { AnyRecord, Mutation, RecordType } from '../../shared/src/index';
import { normalize, uuid } from '../../shared/src/index';

export interface BlobRow {
  id: string;
  blob: Blob;
  uploaded: boolean;
}
export interface MetaRow {
  key: string;
  value: any;
}
export interface OutboxRow extends Mutation {
  seq?: number;
}

class LocalDb extends Dexie {
  records!: Table<AnyRecord, string>;
  outbox!: Table<OutboxRow, number>;
  meta!: Table<MetaRow, string>;
  blobs!: Table<BlobRow, string>;
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      records: 'id, type, projectId, [type+projectId]',
      outbox: '++seq, id',
      meta: 'key',
      blobs: 'id',
    });
  }
}

// Jede Benutzer-Anmeldung bekommt eine eigene lokale Datenbank
export let ldb: LocalDb = new LocalDb('pw-anon');
export function openUserDb(userId: string) {
  ldb = new LocalDb('pw-' + userId);
  return ldb;
}

let afterWrite: () => void = () => {};
export function onLocalWrite(fn: () => void) {
  afterWrite = fn;
}

/** Änderung lokal speichern und zur Synchronisation vormerken */
export async function save<T extends AnyRecord>(type: RecordType, id: string | null, set: Partial<T>, projectId?: string | null): Promise<string> {
  const rid = id || uuid();
  await ldb.transaction('rw', ldb.records, ldb.outbox, async () => {
    const existing = await ldb.records.get(rid);
    const now = new Date().toISOString();
    const pid = projectId ?? existing?.projectId ?? (type === 'project' ? rid : null);
    const full = { ...(existing || { createdAt: now }), ...set, id: rid, type, projectId: pid, updatedAt: now } as AnyRecord;
    await ldb.records.put(full);
    const setWithCreate = existing ? { ...set } : { ...set, createdAt: now, projectId: pid };
    await ldb.outbox.add({ mid: uuid(), id: rid, type, projectId: pid, baseRev: existing?.rev || 0, set: setWithCreate as any, ts: now });
  });
  afterWrite();
  return rid;
}

export async function remove(type: RecordType, id: string) {
  return save(type, id, { deleted: true } as any);
}

export async function getRec<T extends AnyRecord>(id: string): Promise<T | undefined> {
  const r = await ldb.records.get(id);
  return r ? (normalize(r) as T) : undefined;
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const r = await ldb.meta.get(key);
  return r ? (r.value as T) : fallback;
}
export async function setMeta(key: string, value: any) {
  await ldb.meta.put({ key, value });
}
