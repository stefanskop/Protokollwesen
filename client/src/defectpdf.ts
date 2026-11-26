// Mängelliste / Mängelrüge erzeugen
import { ldb } from './db';
import { loadPdfMake, imageDataUrl, defaultLogo } from './pdfgen';
import { planSnippet } from './planrender';
import {
  buildDefectPdf,
  normalize,
  richTextToPlain,
  type DefectPdfContext,
  type AnyRecord,
  type Settings,
  type Project,
  type Item,
  type Entry,
  type Contact,
  type Company,
  type Plan,
} from '../../shared/src/index';

export async function generateDefectPdf(opts: {
  projectId: string;
  itemIds: string[];
  title: string;
  filterInfo?: string;
  letter?: DefectPdfContext['letter'];
  withPlans?: boolean;
}): Promise<{ blob: Blob; filename: string }> {
  const all = (await ldb.records.where('projectId').equals(opts.projectId).toArray()).filter((r) => !r.deleted).map((r) => normalize(r as AnyRecord));
  const settings = normalize(((await ldb.records.get('settings')) || { id: 'settings', type: 'settings' }) as Settings);
  const project = all.find((r) => r.type === 'project') as Project;
  const itemMap = new Map((all.filter((r) => r.type === 'item') as Item[]).map((i) => [i.id, i]));
  const items = opts.itemIds.map((id) => itemMap.get(id)).filter((i): i is Item => !!i);
  const entries = all.filter((r) => r.type === 'entry') as Entry[];
  const files = new Map(all.filter((r) => r.type === 'file').map((f: any) => [f.id, f]));
  const plans = new Map((all.filter((r) => r.type === 'plan') as Plan[]).map((p) => [p.id, p]));
  const contacts = (await ldb.records.where('type').equals('contact').toArray()).map((r) => normalize(r as Contact));
  const companies = (await ldb.records.where('type').equals('company').toArray()).map((r) => normalize(r as Company));

  const texts = new Map<string, string>();
  const photos = new Map<string, string>();
  const snips = new Map<string, string>();
  for (const it of items) {
    const es = entries.filter((e) => e.itemId === it.id).sort((a, b) => a.date.localeCompare(b.date));
    const last = [...es].reverse().find((e) => richTextToPlain(e.text).trim());
    if (last) texts.set(it.id, richTextToPlain(last.text).trim().replace(/\n{2,}/g, '\n'));
    const img = es
      .flatMap((e) => e.fileIds)
      .reverse()
      .find((f) => files.get(f)?.mime?.startsWith('image/'));
    if (img) {
      const d = await imageDataUrl(img);
      if (d) photos.set(it.id, d);
    }
    const m = it.planMarkers?.[0];
    const plan = m && plans.get(m.planId);
    if (opts.withPlans !== false && m && plan) {
      try {
        snips.set(it.id, await planSnippet(plan.fileId, plan.mime, m, it.code));
      } catch (e) {
        console.warn('Planausschnitt nicht möglich', e);
      }
    }
  }
  const doc = buildDefectPdf({
    settings,
    project,
    title: opts.title,
    items,
    texts,
    photos,
    snips,
    contacts: new Map(contacts.map((c) => [c.id, c])),
    companies: new Map(companies.map((c) => [c.id, c])),
    logo: settings.logoFileId ? await imageDataUrl(settings.logoFileId) : await defaultLogo(),
    filterInfo: opts.filterInfo,
    letter: opts.letter,
  });
  const pdfMake = await loadPdfMake();
  const blob: Blob = await new Promise((res) => pdfMake.createPdf(doc).getBlob((b: Blob) => res(b)));
  const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').slice(0, 60);
  return { blob, filename: `${safe(project.name)}_${safe(opts.title)}_${new Date().toISOString().slice(0, 10)}.pdf` };
}
