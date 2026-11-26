import { ldb } from './db';
import { getBlob } from './sync';
import { blobToDataUrl } from './data';
import { planSnippet } from './planrender';
import { buildProtocolPdf, normalize, type Settings, type Project, type Protocol, type Item, type Entry, type Contact, type Company, type FileMeta, type AnyRecord, type Plan } from '../../shared/src/index';

let pdfMakePromise: Promise<any> | null = null;
async function loadPdfMake() {
  if (!pdfMakePromise) {
    pdfMakePromise = (async () => {
      const pdfMake: any = (await import('pdfmake/build/pdfmake')).default;
      const fonts: any = (await import('pdfmake/build/vfs_fonts')).default;
      pdfMake.vfs = fonts?.pdfMake?.vfs ?? fonts?.vfs ?? fonts;
      return pdfMake;
    })();
  }
  return pdfMakePromise;
}

async function imageDataUrl(id: string): Promise<string | undefined> {
  const b = await getBlob(id);
  if (!b || !b.type.startsWith('image/')) return undefined;
  // pdfmake unterstützt nur JPEG/PNG
  if (b.type === 'image/jpeg' || b.type === 'image/png') return blobToDataUrl(b);
  const bmp = await createImageBitmap(b).catch(() => null);
  if (!bmp) return undefined;
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

let logoCache: string | undefined;
async function defaultLogo() {
  if (!logoCache) logoCache = await blobToDataUrl(await (await fetch('/logo.png')).blob());
  return logoCache;
}

export async function generateProtocolPdf(protocolId: string): Promise<{ blob: Blob; filename: string }> {
  const protocol = normalize((await ldb.records.get(protocolId)) as Protocol);
  const all = (await ldb.records.where('projectId').equals(protocol.projectId).toArray()).filter((r) => !r.deleted).map((r) => normalize(r as AnyRecord));
  const settings = normalize(((await ldb.records.get('settings')) || { id: 'settings', type: 'settings' }) as Settings);
  const project = all.find((r) => r.type === 'project') as Project;
  const contacts = (await ldb.records.where('type').equals('contact').toArray()).map((r) => normalize(r as Contact));
  const companies = (await ldb.records.where('type').equals('company').toArray()).map((r) => normalize(r as Company));
  const items = all.filter((r) => r.type === 'item') as Item[];
  const entries = all.filter((r) => r.type === 'entry') as Entry[];
  const files = all.filter((r) => r.type === 'file') as FileMeta[];
  const protocols = all.filter((r) => r.type === 'protocol') as Protocol[];

  const ctx = {
    settings,
    project,
    protocol,
    protocols: new Map(protocols.map((p) => [p.id, p])),
    items: new Map(items.map((i) => [i.id, i])),
    entries,
    contacts: new Map(contacts.map((c) => [c.id, c])),
    companies: new Map(companies.map((c) => [c.id, c])),
    files: new Map(files.map((f) => [f.id, f])),
    images: new Map<string, string>(),
    logo: settings.logoFileId ? await imageDataUrl(settings.logoFileId) : await defaultLogo(),
    typeName: settings.protocolTypes.find((t) => t.key === protocol.typeKey)?.name || protocol.typeKey,
  };
  // benötigte Bilder laden
  const need = new Set<string>();
  if (project.imageFileId) need.add(project.imageFileId);
  const itemIds = new Set(protocol.itemIds);
  for (const e of entries) if (itemIds.has(e.itemId)) e.fileIds.forEach((f) => need.add(f));
  for (const id of need) {
    const d = await imageDataUrl(id);
    if (d) ctx.images.set(id, d);
  }
  // Planausschnitte für verortete Punkte
  if (settings.pdf.fields.planMarkers) {
    const plans = new Map(all.filter((r) => r.type === 'plan').map((p) => [p.id, p as Plan]));
    const snips = new Map<string, { label: string; img: string }[]>();
    for (const id of protocol.itemIds) {
      const it = ctx.items.get(id);
      for (const m of it?.planMarkers || []) {
        const plan = plans.get(m.planId);
        if (!plan) continue;
        try {
          const img = await planSnippet(plan.fileId, plan.mime, m, it!.code);
          const label = `${plan.name}${plan.index ? ' (Index ' + plan.index + ')' : ''}`;
          snips.set(id, [...(snips.get(id) || []), { label, img }]);
        } catch (e) {
          console.warn('Planausschnitt nicht möglich', e);
        }
      }
    }
    (ctx as any).planSnips = snips;
  }
  const pdfMake = await loadPdfMake();
  const doc = buildProtocolPdf(ctx);
  const blob: Blob = await new Promise((res) => pdfMake.createPdf(doc).getBlob((b: Blob) => res(b)));
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  const filename = `${safe(project.name.split(' - ')[0] || project.name)}_${protocol.code}_${safe(protocol.title)}.pdf`;
  return { blob, filename };
}
