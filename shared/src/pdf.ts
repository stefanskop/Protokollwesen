// Erzeugt die pdfmake-Dokumentdefinition eines Protokolls.
// Läuft identisch im Browser (auch offline) und könnte serverseitig genutzt werden.
import type { Settings, Project, Protocol, Item, Entry, Contact, Company, FileMeta } from './model';
import { fmtDate, contactName, groupedItems, entriesForItemInProtocol } from './logic';
import { richTextToPdf } from './richtext';

export interface PdfContext {
  settings: Settings;
  project: Project;
  protocol: Protocol;
  protocols: Map<string, Protocol>;
  items: Map<string, Item>;
  entries: Entry[];
  contacts: Map<string, Contact>;
  companies: Map<string, Company>;
  files: Map<string, FileMeta>;
  /** fileId → dataURL (nur Bilder) */
  images: Map<string, string>;
  logo?: string; // dataURL
  typeName: string;
}

const GREY = '#6b6b6b';
const LINK = '#2f8fc5';
const RED = '#b00045';
const LINE = '#bdbdbd';

function checkbox(checked: boolean) {
  const c: any[] = [{ type: 'rect', x: 0, y: 0, w: 8, h: 8, r: 1.5, lineWidth: 0.7, lineColor: checked ? '#111' : '#b5b5b5' }];
  if (checked) c.push({ type: 'polyline', lineWidth: 1, lineColor: '#111', points: [{ x: 1.8, y: 4.2 }, { x: 3.4, y: 6 }, { x: 6.4, y: 2 }] });
  return { canvas: c, alignment: 'center', margin: [0, 1, 0, 0] };
}

function dot(color: string) {
  return { canvas: [{ type: 'ellipse', x: 4, y: 5, r1: 4, r2: 4, color, lineColor: '#7a0030', lineWidth: 0.8 }], width: 10 };
}

const imgWidth = { none: 0, small: 140, medium: 220, large: 380 } as const;

export function buildProtocolPdf(ctx: PdfContext): any {
  const { settings, project, protocol, contacts, companies } = ctx;
  const L = settings.pdf;
  const accent = L.accentColor || '#002E5E';
  const titleLine = `${ctx.typeName} | Nr. ${protocol.code}`;
  const content: any[] = [];

  // ---------- Kopf ----------
  const leftHead: any[] = [
    { text: project.name, fontSize: 17, color: GREY },
    L.showProjectAddress ? { text: project.address, fontSize: 9 } : null,
    L.showProjectNumber && project.number ? { text: `Projekt-Nr. ${project.number}`, fontSize: 8, color: GREY, margin: [0, 1, 0, 0] } : null,
  ].filter(Boolean);
  content.push({
    columns: [
      { width: '*', stack: leftHead },
      {
        width: 190,
        margin: [0, 10, 0, 0],
        stack: [
          { text: 'Auftraggeber', fontSize: 7.5, color: GREY },
          { text: project.clientName || '', fontSize: 8.5 },
          { text: project.clientAddress || '', fontSize: 8.5 },
        ],
      },
    ],
  });
  content.push({ text: L.showProtocolNumber ? titleLine : ctx.typeName, fontSize: 18, bold: true, color: '#555', margin: [0, 8, 0, 8] });

  const projectImg = project.imageFileId ? ctx.images.get(project.imageFileId) : undefined;
  const statusText = protocol.status === 'abgeschlossen' ? 'abgeschlossen' : 'Entwurf';
  const lbl = (t: string) => ({ text: t, fontSize: 7, color: GREY });
  content.push({
    columns: [
      projectImg ? { image: projectImg, fit: [140, 80], width: 150 } : { text: '', width: 0 },
      {
        width: '*',
        stack: [lbl('Bezeichnung'), { text: protocol.title, fontSize: 11.5, margin: [0, 0, 0, 8] }, lbl('Ort'), { text: protocol.location, fontSize: 11.5 }],
      },
      {
        width: 150,
        table: {
          widths: ['50%', '50%'],
          body: [
            [{ stack: [lbl('Datum'), { text: fmtDate(protocol.date), fontSize: 10.5 }] }, { stack: [lbl('Uhrzeit'), { text: [protocol.timeFrom, protocol.timeTo].filter(Boolean).join(' - '), fontSize: 10.5 }] }],
            [
              { stack: [lbl('Versendet am'), { text: fmtDate(protocol.sentAt) || '–', fontSize: 10.5 }] },
              { stack: [lbl('Protokollstatus'), { text: statusText, fontSize: 10.5, color: protocol.status === 'abgeschlossen' ? '#5cb85c' : '#d08a00' }] },
            ],
          ],
        },
        layout: 'noBorders',
      },
    ],
    columnGap: 12,
    margin: [0, 0, 0, 12],
  });

  const nm = protocol.nextMeeting;
  if (nm && nm.date) {
    content.push({
      columns: [
        { text: 'Nächste Besprechung', color: LINK, fontSize: 10.5, width: 130 },
        { text: 'mehr Informationen auf der letzten Seite', fontSize: 7.5, width: '*', margin: [0, 2, 0, 0] },
        { text: `${fmtDate(nm.date)} | von ${nm.timeFrom} bis ${nm.timeTo}`, fontSize: 10, alignment: 'right', width: 'auto' },
      ],
      margin: [0, 0, 0, 2],
    });
    content.push(hr());
  }

  // ---------- Beteiligtenliste ----------
  if (L.showAttendees) {
    content.push({ text: 'Beteiligtenliste', color: LINK, fontSize: 10.5, margin: [0, 8, 0, 2] });
    const att = new Map(protocol.attendees.map((a) => [a.contactId, a]));
    const roleOf = new Map(project.participants.map((p) => [p.contactId, p.role]));
    let ids = L.allProjectContacts ? project.participants.map((p) => p.contactId) : protocol.attendees.filter((a) => a.distribution || a.present).map((a) => a.contactId);
    for (const a of protocol.attendees) if (!ids.includes(a.contactId)) ids.push(a.contactId);
    const byCompany = new Map<string, Contact[]>();
    for (const id of ids) {
      const c = contacts.get(id);
      if (!c || c.deleted) continue;
      const name = (c.companyId && companies.get(c.companyId)?.name) || 'Ohne Firma';
      if (!byCompany.has(name)) byCompany.set(name, []);
      byCompany.get(name)!.push(c);
    }
    const body: any[] = [
      ['Name (ohne Titel)', 'Gewerk', 'Telefonnr.', 'E-Mail', 'Vert.', 'Teil.'].map((t, i) => ({ text: t, bold: true, fontSize: 8, alignment: i > 3 ? 'center' : 'left' })),
    ];
    const companyRows: number[] = [];
    for (const [cname, list] of [...byCompany.entries()].sort((a, b) => a[0].localeCompare(b[0], 'de'))) {
      companyRows.push(body.length);
      body.push([{ text: cname, bold: true, fontSize: 9.5, colSpan: 6, margin: [-4, 3, 0, 0] }, '', '', '', '', '']);
      list.sort((a, b) => a.lastName.localeCompare(b.lastName, 'de'));
      for (const c of list) {
        const a = att.get(c.id);
        body.push([
          { text: contactName(c), fontSize: 7.5, margin: [6, 0, 0, 0] },
          { text: roleOf.get(c.id) || c.function || '', fontSize: 7.5 },
          { text: c.phone || '', fontSize: 7.5, color: LINK },
          { text: c.email || '', fontSize: 7.5, color: LINK },
          checkbox(!!a?.distribution),
          checkbox(!!a?.present),
        ]);
      }
    }
    content.push({
      table: { headerRows: 1, widths: [130, 90, 78, '*', 26, 26], body, dontBreakRows: true },
      layout: {
        hLineWidth: (i: number) => (i === 0 || companyRows.includes(i) ? 0 : 0.5),
        vLineWidth: () => 0,
        hLineColor: () => LINE,
        paddingTop: () => 2,
        paddingBottom: () => 2,
      },
    });
  }

  if (protocol.startText) content.push({ text: protocol.startText, fontSize: 9, margin: [0, 10, 0, 0] });

  // ---------- Punkte ----------
  const groups = groupedItems(protocol, ctx.items);
  let first = true;
  for (const g of groups) {
    if (protocol.groupBy !== 'none' && g.key) {
      content.push({
        text: g.key,
        fontSize: 13,
        bold: true,
        margin: [0, 14, 0, 4],
        pageBreak: first && L.entriesOnSecondPage ? 'before' : undefined,
      });
      first = false;
    }
    for (const it of g.items) {
      const block = itemBlock(ctx, it, accent);
      if (first && L.entriesOnSecondPage) block.pageBreak = 'before';
      else if (L.newPagePerEntry && !first) block.pageBreak = 'before';
      first = false;
      content.push(block);
    }
  }

  // ---------- Endtext ----------
  const endText = protocol.endText ?? settings.endText;
  content.push({ text: 'Endtext', color: LINK, fontSize: 10.5, margin: [0, 18, 0, 2] });
  content.push(hr());
  content.push({ text: endText, fontSize: 8.5, margin: [0, 4, 0, 2] });
  if (settings.signature) content.push({ text: settings.signature, fontSize: 8.5 });

  // ---------- Nächste Besprechung ----------
  if (nm && nm.date) {
    content.push({
      columns: [
        { text: 'Nächste Besprechung', color: LINK, fontSize: 10.5 },
        { text: `${fmtDate(nm.date)} | von ${nm.timeFrom} bis ${nm.timeTo}`, fontSize: 10, alignment: 'right' },
      ],
      margin: [0, 18, 0, 2],
    });
    content.push(hr());
    if (nm.location) content.push({ text: `Ort: ${nm.location}`, fontSize: 8.5, margin: [0, 4, 0, 0] });
    if (nm.note) content.push({ text: nm.note, fontSize: 8.5, margin: [0, 2, 0, 0] });
    if (nm.inviteeIds.length) {
      const body: any[] = [['Firma', 'Name (ohne Titel)', 'E-Mail', 'Telefonnr.', 'Zeitraum'].map((t) => ({ text: t, bold: true, fontSize: 8 }))];
      for (const id of nm.inviteeIds) {
        const c = contacts.get(id);
        if (!c) continue;
        body.push([
          { text: (c.companyId && companies.get(c.companyId)?.name) || '', fontSize: 7.5 },
          { text: contactName(c), fontSize: 7.5 },
          { text: c.email || '', fontSize: 7.5, color: LINK },
          { text: c.phone || '', fontSize: 7.5, color: LINK },
          { text: `${nm.timeFrom} - ${nm.timeTo}`, fontSize: 7.5 },
        ]);
      }
      content.push({
        table: { headerRows: 1, widths: [110, 95, '*', 75, 50], body },
        layout: { hLineWidth: (i: number) => (i === 0 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => LINE },
        margin: [0, 6, 0, 0],
      });
    }
  }

  const companyLine = [settings.companyName, settings.companyAddress].filter(Boolean).join(' - ');
  return {
    pageSize: 'A4',
    pageMargins: [40, 62, 40, 46],
    info: { title: `${project.name} – ${titleLine}`, author: settings.companyName },
    defaultStyle: { font: 'Roboto', fontSize: 9, lineHeight: 1.12 },
    header: (page: number) =>
      page === 1
        ? {
            columns: [
              L.showCompanyHeader ? { text: companyLine, fontSize: 7.5, margin: [40, 34, 0, 0] } : { text: '' },
              ctx.logo ? { image: ctx.logo, fit: [120, 34], alignment: 'right', margin: [0, 18, 40, 0] } : { text: '' },
            ],
          }
        : {
            columns: [
              { text: [{ text: `${project.name}   /   ` }, { text: titleLine, bold: true }], fontSize: 9.5, width: '*' },
              { text: fmtDate(protocol.date), bold: true, fontSize: 9.5, alignment: 'right', width: 80 },
            ],
            margin: [40, 26, 40, 0],
          },
    footer: (page: number, pages: number) => ({
      columns: [
        { text: page > 1 && L.showCompanyHeader ? companyLine : '', fontSize: 7, color: GREY },
        { text: `Seite ${page}/${pages}`, alignment: 'right', fontSize: 8 },
      ],
      margin: [40, 14, 40, 0],
    }),
    content,
  };
}

function hr() {
  return { canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.6, lineColor: LINE }], margin: [0, 1, 0, 2] };
}

function itemBlock(ctx: PdfContext, it: Item, accent: string): any {
  const { settings, protocol, contacts, companies } = ctx;
  const F = settings.pdf.fields;
  const entries = entriesForItemInProtocol(it, protocol, ctx.entries, ctx.protocols);

  // Kopfzeile: Nummer, Fälligkeit, Status
  const due =
    F.due && (it.dueFrom || it.dueTo) && it.status !== 'info'
      ? {
          text: [
            { text: 'fällig  ', fontSize: 8.5 },
            { text: fmtDate(it.dueFrom || it.dueTo), bold: true, color: RED, fontSize: 9 },
            ...(it.dueFrom && it.dueTo && it.dueFrom !== it.dueTo ? [{ text: '  bis  ', fontSize: 8.5 }, { text: fmtDate(it.dueTo), bold: true, color: RED, fontSize: 9 }] : []),
          ],
          width: '*',
        }
      : { text: '', width: '*' };
  const statusCol: any[] = [];
  if (it.status !== 'info') {
    statusCol.push({ text: it.status === 'erledigt' ? 'Erledigt' : 'Offen', fontSize: 8, width: 'auto', margin: [0, 1, 6, 0] });
    if (F.priority && it.priority === 'hoch') statusCol.push(dot(RED));
    else statusCol.push({ ...checkbox(it.status === 'erledigt'), width: 10 });
  }
  const head = {
    columns: [{ text: it.code, color: LINK, fontSize: 8, width: 120 }, due, ...statusCol],
    margin: [6, 0, 0, 3],
  };

  // Mittelspalte: Titel + Einträge
  const mid: any[] = [{ text: it.title, bold: true, fontSize: 9.5, margin: [0, 0, 0, 6] }];
  const pics: any[] = [];
  let picNo = 0;
  for (const e of entries) {
    const italic = e.addendum;
    mid.push({ text: `Anm. ${fmtDate(e.date)}:`, italics: italic, fontSize: 8.5, margin: [0, 2, 0, 1] });
    mid.push(...richTextToPdf(e.text, italic));
    const w = imgWidth[settings.pdf.imageSize];
    if (w) {
      for (const fid of e.fileIds) {
        const img = ctx.images.get(fid);
        if (!img) continue;
        picNo++;
        const meta = ctx.files.get(fid);
        pics.push({
          stack: [
            { text: String(picNo), alignment: 'center', fontSize: 8, margin: [0, 0, 0, 2] },
            { image: img, fit: [w, w * 1.35], alignment: 'center' },
            meta?.caption ? { text: meta.caption, fontSize: 7.5, alignment: 'center', margin: [0, 2, 0, 0] } : null,
          ].filter(Boolean),
          width: w,
          margin: [0, 6, 6, 0],
        });
      }
    }
  }

  // Rechte Spalte: Felder
  const meta: any[] = [];
  const add = (label: string, value: string | undefined | null, bold = true) => {
    if (!value) return;
    meta.push([{ text: label, fontSize: 7, margin: [0, 1, 0, 0] }, { text: value, fontSize: 8.5, bold }]);
  };
  if (F.company) add('Firma', it.companyId ? companies.get(it.companyId)?.name : 'Projektteam');
  if (F.responsible) add('Zuständig', contactName(it.responsibleId ? contacts.get(it.responsibleId) : null));
  if (F.observer && it.observerIds.length)
    add('Beobachter', it.observerIds.map((id) => companies.get(id)?.name || contactName(contacts.get(id))).filter(Boolean).join(', '));
  if (F.itemType) add('Typ', it.itemType);
  if (F.trade) add('Gewerk', it.trade, false);
  if (F.category) add('Zusatzfeld', it.category, false);
  if (F.location) add('Lage', it.location, false);

  const row: any[] = [
    { text: fmtDate(it.createdAt?.slice(0, 10) || ctx.protocols.get(it.originProtocolId)?.date), fontSize: 8.5 },
    { stack: mid },
    meta.length
      ? {
          table: { widths: [50, '*'], body: meta },
          layout: { hLineWidth: (i: number, n: any) => (i > 0 && i < n.table.body.length ? 0.5 : 0), vLineWidth: () => 0, hLineColor: () => LINE, paddingTop: () => 4, paddingBottom: () => 5 },
        }
      : { text: '' },
  ];
  const body: any[] = [row];
  if (pics.length) {
    body.push([{ text: '' }, { colSpan: 2, stack: [{ text: 'Fotos & Daten', color: LINK, fontSize: 9.5, margin: [0, 4, 0, 0] }, { columns: pics, columnGap: 4 }] }, '']);
  }
  return {
    stack: [
      head,
      {
        table: { widths: [56, '*', 160], body, dontBreakRows: false },
        layout: {
          hLineWidth: (i: number, n: any) => (i === 0 || i === n.table.body.length ? 0.6 : 0),
          vLineWidth: (i: number) => (i === 0 ? 0.6 : 0),
          hLineColor: () => '#999',
          vLineColor: () => '#999',
          paddingTop: () => 4,
          paddingBottom: () => 8,
        },
      },
    ],
    margin: [0, 14, 0, 0],
    unbreakable: ctx.settings.pdf.keepEntryTogether && entries.length < 4 && pics.length === 0,
  };
  void accent;
}
