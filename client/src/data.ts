// Lese-Hooks und Hilfsfunktionen für die Oberfläche
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { ldb, save, putBlob, rowToBlob } from './db';
import { getBlob } from './sync';
import {
  normalize,
  DEFAULT_SETTINGS,
  type Settings,
  type Company,
  type Contact,
  type Project,
  type Protocol,
  type Item,
  type Entry,
  type FileMeta,
  type AnyRecord,
  uuid,
} from '../../shared/src/index';

const live = <T extends AnyRecord>(list: AnyRecord[] | undefined) => (list || []).filter((r) => !r.deleted).map((r) => normalize(r) as T);

export function useSettings(): Settings {
  const s = useLiveQuery(() => ldb.records.get('settings'), []);
  return normalize((s || { ...DEFAULT_SETTINGS, id: 'settings', type: 'settings' }) as Settings);
}

export function useGlobal() {
  const companies = useLiveQuery(() => ldb.records.where('type').equals('company').toArray(), []);
  const contacts = useLiveQuery(() => ldb.records.where('type').equals('contact').toArray(), []);
  const c1 = live<Company>(companies);
  const c2 = live<Contact>(contacts);
  return {
    loaded: !!companies && !!contacts,
    companies: c1.sort((a, b) => a.name.localeCompare(b.name, 'de')),
    contacts: c2,
    companyMap: new Map(c1.map((c) => [c.id, c])),
    contactMap: new Map(c2.map((c) => [c.id, c])),
  };
}

export function useProjects() {
  const p = useLiveQuery(() => ldb.records.where('type').equals('project').toArray(), []);
  return { loaded: !!p, projects: live<Project>(p).sort((a, b) => (b.number || '').localeCompare(a.number || '', 'de', { numeric: true })) };
}

export function useProjectData(projectId: string | undefined) {
  const recs = useLiveQuery(() => (projectId ? ldb.records.where("projectId").equals(projectId).toArray() : Promise.resolve([] as AnyRecord[])), [projectId]);
  const all = live<AnyRecord>(recs);
  const project = all.find((r) => r.type === 'project') as Project | undefined;
  const protocols = all.filter((r) => r.type === 'protocol') as Protocol[];
  const items = all.filter((r) => r.type === 'item') as Item[];
  const entries = all.filter((r) => r.type === 'entry') as Entry[];
  const files = all.filter((r) => r.type === 'file') as FileMeta[];
  return {
    loaded: !!recs,
    project,
    protocols: protocols.sort((a, b) => (a.date === b.date ? b.seq - a.seq : b.date.localeCompare(a.date))),
    protocolMap: new Map(protocols.map((p) => [p.id, p])),
    items,
    itemMap: new Map(items.map((i) => [i.id, i])),
    entries,
    files,
    fileMap: new Map(files.map((f) => [f.id, f])),
  };
}

/** Objekt-URL für eine Datei (lokal oder vom Server). retry() lädt neu vom Server. */
export function useFileUrl(id?: string | null): string | undefined {
  return useFileUrlEx(id).url;
}
export function useFileUrlEx(id?: string | null) {
  const [url, setUrl] = useState<string>();
  const [server, setServer] = useState(false);
  const blobRow = useLiveQuery(() => (id ? ldb.blobs.get(id) : undefined), [id]);
  useEffect(() => {
    let u: string | undefined;
    let cancelled = false;
    (async () => {
      if (!id) return setUrl(undefined);
      const local = server ? undefined : rowToBlob(blobRow);
      const b = local && local.size ? local : await getBlob(id, server);
      if (cancelled || !b) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    })();
    return () => {
      cancelled = true;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id, blobRow, server]);
  return { url, retry: () => !server && setServer(true), fromServer: server };
}

/** Bild dekodieren – createImageBitmap, sonst über <img> (Safari: HEIC) */
async function decodeImage(file: Blob): Promise<CanvasImageSource & { width: number; height: number } | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    /* weiter mit <img> */
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } catch {
    return null;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

const isHeic = (f: Blob & { name?: string }) => /heic|heif/i.test(f.type) || /\.(heic|heif)$/i.test(f.name || '');

/** Bild verkleinern (iPad-Fotos ~12 MP) und in JPEG umwandeln (auch HEIC) → max. 2000 px */
export async function shrinkImage(file: Blob & { name?: string }, max = 2000, quality = 0.85): Promise<Blob> {
  const heic = isHeic(file);
  if (!heic && (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml')) return file;
  const bmp = await decodeImage(file);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (!heic && scale === 1 && file.size < 1.5e6 && file.type === 'image/jpeg') return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise<Blob>((res) => c.toBlob((b) => res(b || file), 'image/jpeg', quality));
}

/** Datei lokal ablegen und als Datensatz registrieren */
export async function addFile(file: File | Blob, projectId: string | null, name?: string): Promise<string> {
  const id = uuid();
  const blob = await shrinkImage(file);
  await putBlob(id, blob, false);
  let fname = name || (file as File).name || 'Datei';
  if (blob.type === 'image/jpeg' && /\.(heic|heif|png)$/i.test(fname)) fname = fname.replace(/\.[^.]+$/, '.jpg');
  const mime = blob.type || (isHeic(file as any) ? 'image/heic' : 'application/octet-stream');
  await save<FileMeta>('file', id, { name: fname, mime, size: blob.size } as any, projectId);
  return id;
}

export function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });
}
