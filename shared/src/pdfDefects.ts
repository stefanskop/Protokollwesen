// Mängelliste / Aufforderung zur Mängelbehebung als PDF (pdfmake)
import type { Settings, Project, Item, Contact, Company } from './model';
import { fmtDate, contactName, STATUS_LABEL } from './logic';

export interface DefectPdfContext {
  settings: Settings;
  project: Project;
  title: string; // "Mängelliste" oder "Aufforderung zur Mängelbehebung"
  items: Item[];
  /** letzter Text je Mangel (Klartext) */
  texts: Map<string, string>;
  /** erstes Foto je Mangel (dataURL) */
  photos: Map<string, string>;
  /** Planausschnitt je Mangel (dataURL) */
  snips?: Map<string, string>;
  contacts: Map<string, Contact>;
  companies: Map<string, Company>;
  logo?: string;
  filterInfo?: string;
  /** Mängelrüge: Empfänger und Anschreiben */
  letter?: { companyName: string; address?: string; text: string; deadline?: string };
}

const GREY = '#6b6b6b';
const RED = '#b00045';
const LINE = '#bdbdbd';

export function buildDefectPdf(ctx: DefectPdfContext): any {
  const { settings, project } = ctx;
  const content: any[] = [];
  const companyLine = [settings.companyName, settings.companyAddress].filter(Boolean).join(' - ');

  content.push({
    columns: [
      { stack: [{ text: project.name, fontSize: 15, color: GREY }, { text: project.address, fontSize: 9 }], width: '*' },
      { stack: [{ text: 'Datum', fontSize: 7, color: GREY }, { text: fmtDate(new Date().toISOString().slice(0, 10)), fontSize: 10 }], width: 90 },
    ],
  });
  content.push({ text: ctx.title, fontSize: 18, bold: true, color: '#555', margin: [0, 8, 0, 4] });
  if (ctx.filterInfo) content.push({ text: ctx.filterInfo, fontSize: 8, color: GREY, margin: [0, 0, 0, 8] });

  if (ctx.letter) {
    content.push({ text: [{ text: 'An: ', color: GREY }, { text: ctx.letter.companyName, bold: true }], fontSize: 10, margin: [0, 4, 0, 0] });
    if (ctx.letter.address) content.push({ text: ctx.letter.address, fontSize: 9 });
    content.push({ text: ctx.letter.text, fontSize: 9.5, margin: [0, 10, 0, 6], lineHeight: 1.2 });
    if (ctx.letter.deadline)
      content.push({ text: [{ text: 'Frist zur Behebung: ' }, { text: fmtDate(ctx.letter.deadline), bold: true, color: RED }], fontSize: 10, margin: [0, 0, 0, 10] });
  }

  // Übersicht
  const count = (st: string) => ctx.items.filter((i) => i.status === st).length;
  const sum = ctx.items.reduce((n, i) => n + (i.cost || 0), 0);
  content.push({
    text: `${ctx.items.length} Mängel · offen ${count('offen')} · behoben gemeldet ${count('behoben')} · erledigt ${count('erledigt')}${
      sum ? ' · Abzüge/Kosten ' + sum.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }) : ''
    }`,
    fontSize: 8.5,
    margin: [0, 0, 0, 8],
  });

  // nach Firma gruppiert
  const groups = new Map<string, Item[]>();
  for (const it of ctx.items) {
    const k = (it.companyId && ctx.companies.get(it.companyId)?.name) || 'Ohne Firma';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(it);
  }
  const today = new Date().toISOString().slice(0, 10);
  for (const [name, list] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
    if (!ctx.letter) content.push({ text: `${name} (${list.length})`, fontSize: 12, bold: true, margin: [0, 10, 0, 4] });
    const body: any[] = [['Nr.', 'Mangel', 'Foto / Plan', 'Frist', 'Status'].map((t) => ({ text: t, bold: true, fontSize: 8 }))];
    for (const it of list.sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }))) {
      const due = it.dueTo || it.dueFrom;
      const desc: any[] = [{ text: it.title, bold: true, fontSize: 9 }];
      const meta = [it.location && `Lage: ${it.location}`, it.trade && `Gewerk: ${it.trade}`, it.defectType, it.responsibleId && `Zuständig: ${contactName(ctx.contacts.get(it.responsibleId))}`]
        .filter(Boolean)
        .join(' · ');
      if (meta) desc.push({ text: meta, fontSize: 7.5, color: GREY, margin: [0, 1, 0, 2] });
      const t = ctx.texts.get(it.id);
      if (t) desc.push({ text: t, fontSize: 8.5 });
      if (it.cost) desc.push({ text: 'Abzug/Kosten: ' + it.cost.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }), fontSize: 8, margin: [0, 2, 0, 0] });
      const media: any[] = [];
      const ph = ctx.photos.get(it.id);
      if (ph) media.push({ image: ph, fit: [110, 80], margin: [0, 0, 0, 3] });
      const sn = ctx.snips?.get(it.id);
      if (sn) media.push({ image: sn, fit: [110, 70] });
      body.push([
        { text: it.code, fontSize: 8, color: '#2f8fc5' },
        { stack: desc },
        media.length ? { stack: media } : { text: '' },
        { text: fmtDate(due), fontSize: 8.5, bold: !!due && due < today && it.status === 'offen', color: due && due < today && it.status === 'offen' ? RED : undefined },
        {
          stack: [
            { text: STATUS_LABEL[it.status] || it.status, fontSize: 8.5, color: it.status === 'erledigt' ? '#2e8b57' : it.status === 'behoben' ? '#d08a00' : RED },
            it.fixedReportedAt ? { text: 'gem. ' + fmtDate(it.fixedReportedAt), fontSize: 7, color: GREY } : null,
            it.acceptedAt ? { text: 'abg. ' + fmtDate(it.acceptedAt), fontSize: 7, color: GREY } : null,
          ].filter(Boolean),
        },
      ]);
    }
    content.push({
      table: { headerRows: 1, widths: [58, '*', 116, 50, 62], body, dontBreakRows: true },
      layout: { hLineWidth: (i: number) => (i === 0 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 4, paddingBottom: () => 4 },
    });
  }

  if (ctx.letter) {
    content.push({ text: 'Wir ersuchen um schriftliche Meldung der erfolgten Behebung.', fontSize: 9, margin: [0, 14, 0, 2] });
    content.push({ text: 'Mit freundlichen Grüßen', fontSize: 9, margin: [0, 8, 0, 2] });
    content.push({ text: settings.companyName, fontSize: 9 });
    if (settings.signature) content.push({ text: settings.signature, fontSize: 9 });
  }

  return {
    pageSize: 'A4',
    pageMargins: [40, 62, 40, 46],
    info: { title: `${project.name} – ${ctx.title}`, author: settings.companyName },
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.12 },
    header: (page: number) =>
      page === 1
        ? {
            columns: [
              { text: companyLine, fontSize: 7.5, margin: [40, 34, 0, 0] },
              ctx.logo ? { image: ctx.logo, fit: [120, 34], alignment: 'right', margin: [0, 18, 40, 0] } : { text: '' },
            ],
          }
        : { columns: [{ text: [{ text: `${project.name}   /   ` }, { text: ctx.title, bold: true }], fontSize: 9.5 }], margin: [40, 26, 40, 0] },
    footer: (page: number, pages: number) => ({
      columns: [{ text: page > 1 ? companyLine : '', fontSize: 7, color: GREY }, { text: `Seite ${page}/${pages}`, alignment: 'right', fontSize: 8 }],
      margin: [40, 14, 40, 0],
    }),
    content,
  };
}
