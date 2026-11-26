// Liest Baumaster-Protokoll-PDFs (Text mit Positionen) und erzeugt eine strukturierte Darstellung.
// Eingabe: je Seite eine Liste von Wörtern mit Position (pt, Ursprung oben links) und Schriftschnitt.

export interface PdfWord {
  x: number;
  y: number;
  w: number;
  s: string;
  size: number;
  bold: boolean;
  italic: boolean;
}
export interface PdfPage {
  width: number;
  height: number;
  words: PdfWord[];
}

export interface BmRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
}
export interface BmBlock {
  kind: 'p' | 'li';
  level: number;
  runs: BmRun[];
}
export interface BmEntry {
  date: string; // ISO
  italic: boolean; // Ergänzung
  blocks: BmBlock[];
}
export interface BmItem {
  code: string;
  created?: string;
  title: string;
  status: 'info' | 'offen' | 'erledigt';
  dueFrom?: string;
  dueTo?: string;
  group?: string;
  fields: Record<string, string>; // Firma, Zuständig, Beobachter, Typ, Gewerk, Zusatzfeld, Lage …
  entries: BmEntry[];
  hasPhotos: boolean;
}
export interface BmParticipant {
  company: string;
  name: string;
  role: string;
  phone: string;
  email: string;
}
export interface BmProtocol {
  projectTitle: string;
  projectAddress: string;
  clientName: string;
  clientAddress: string;
  typeName: string;
  code: string;
  prefix: string;
  seq: number;
  title: string;
  date: string;
  timeFrom: string;
  timeTo: string;
  location: string;
  sentAt?: string;
  closed: boolean;
  nextMeeting?: { date: string; timeFrom: string; timeTo: string };
  participants: BmParticipant[];
  items: BmItem[];
  warnings: string[];
}

const DATE = /(\d{2})\.(\d{2})\.(\d{4})/;
const iso = (s?: string) => {
  const m = s ? DATE.exec(s) : null;
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const CODE = /^[A-ZÄÖÜ][A-ZÄÖÜ0-9-]{0,7}\d\.\d{3}$/;

interface Row {
  page: number;
  y: number;
  words: PdfWord[];
}

/** Wörter seitenweise zu Zeilen (gleiche Höhe) zusammenfassen */
function rows(pages: PdfPage[]): Row[] {
  const out: Row[] = [];
  pages.forEach((pg, pi) => {
    const ws = pg.words.filter((w) => w.s.trim()).sort((a, b) => a.y - b.y || a.x - b.x);
    const local: Row[] = [];
    for (const w of ws) {
      let r = local.find((r) => Math.abs(r.y - w.y) < 2.2);
      if (!r) local.push((r = { page: pi, y: w.y, words: [] }));
      r.words.push(w);
    }
    local.sort((a, b) => a.y - b.y);
    for (const r of local) r.words.sort((a, b) => a.x - b.x);
    out.push(...local);
  });
  return out;
}

/** Wörter zu Text verbinden (Abstand → Leerzeichen) */
const needsSpace = (prev: string, gap: number) => gap > 0.8 && !(/[-/]$/.test(prev) && gap < 2.6);

function join(ws: PdfWord[], glue = ' ') {
  let t = '';
  let x2 = -1;
  for (const w of ws) {
    if (t && glue && needsSpace(t, w.x - x2)) t += glue;
    t += w.s;
    x2 = w.x + w.w;
  }
  return t.trim();
}
const text = (r: Row, x0 = 0, x1 = 1e9) => join(r.words.filter((w) => w.x >= x0 && w.x < x1));

// Spaltengrenzen (A4 hoch, 595 pt)
const Z = { L: 100, M: 378, K: 438 };

export function parseBaumaster(pages: PdfPage[]): BmProtocol {
  const warnings: string[] = [];
  const all = rows(pages).filter((r) => {
    if (r.page > 0 && r.y < 50) return false; // Seitenkopf
    if (r.y > pages[r.page].height - 35) return false; // Fußzeile
    return true;
  });
  const first = all.filter((r) => r.page === 0);

  // ---------------- Kopf ----------------
  const below = (label: string, x0: number, x1: number, maxDy = 30) => {
    const lr = first.find((r) => r.words.some((w) => w.s === label && w.x >= x0 - 3 && w.x < x1));
    if (!lr) return [] as Row[];
    return first.filter((r) => r.y > lr.y + 3 && r.y < lr.y + maxDy && r.words.some((w) => w.x >= x0 - 3 && w.x < x1 && w.size >= 8.5));
  };
  const proj = first.find((r) => r.words.some((w) => w.size >= 14 && w.size < 17));
  const projectTitle = proj ? join(proj.words.filter((w) => w.size >= 14)) : '';
  const addrRow = proj ? first.find((r) => r.y > proj.y + 4 && r.y < proj.y + 20) : undefined;
  const projectAddress = addrRow ? text(addrRow, 0, 380) : '';
  // Titel kann über mehrere Zeilen umbrechen
  const titleTxt = first
    .filter((r) => r.words.some((w) => w.size >= 17))
    .map((r) => join(r.words.filter((w) => w.size >= 17)))
    .join(' ');
  const tm = /^(.*?)\s*\|\s*Nr\.\s*(\S+)/.exec(titleTxt);
  const typeName = (tm?.[1] || '').replace(/_+$/, '').trim();
  const code = tm?.[2] || '';
  const cm = /^(.*?)(\d+)$/.exec(code.replace(/-/g, ''));
  const prefix = cm ? cm[1] : code;
  const seq = cm ? parseInt(cm[2], 10) : 1;

  const agLabel = first.find((r) => r.words.some((w) => w.s === 'Auftraggeber' && w.x > 350));
  const agRows = agLabel
    ? first
        .filter((r) => r.y > agLabel.y + 3 && r.y < agLabel.y + 32)
        .map((r) => join(r.words.filter((w) => w.x >= 350 && w.size < 11)))
        .filter(Boolean)
    : [];
  const bez = below('Bezeichnung', 150, 380, 45)
    .filter((r) => !r.words.some((w) => w.s === 'Ort' && w.size < 8))
    .map((r) => text(r, 150, 380));
  const ortLabel = first.find((r) => r.words.some((w) => w.s === 'Ort' && w.size < 8 && w.x > 150 && w.x < 380));
  const ort = ortLabel ? first.filter((r) => r.y > ortLabel.y + 3 && r.y < ortLabel.y + 30).map((r) => text(r, 150, 400)).filter(Boolean) : [];
  const datum = below('Datum', 390, 470, 16).map((r) => text(r, 390, 470))[0] || '';
  const uhr = below('Uhrzeit', 470, 600, 16).map((r) => text(r, 470, 600))[0] || '';
  const versendet = below('Versendet', 390, 470, 16).map((r) => text(r, 390, 470))[0] || '';
  const status = below('Protokollstatus', 470, 600, 16).map((r) => text(r, 470, 600))[0] || '';
  const um = /(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/.exec(uhr);
  const nmRow = first.find((r) => /Nächste Besprechung/.test(join(r.words)));
  const nmTxt = nmRow ? join(nmRow.words) : '';
  const nmm = /(\d{2}\.\d{2}\.\d{4}).*?von\s*(\d{1,2}:\d{2})\s*bis\s*(\d{1,2}:\d{2})/.exec(nmTxt);

  // ---------------- Beteiligte ----------------
  const participants: BmParticipant[] = [];
  const startIdx = all.findIndex((r) => r.page === 0 && /^Beteiligtenliste/.test(join(r.words)));
  let i = startIdx >= 0 ? startIdx + 1 : all.length;
  let company = '';
  let cur: BmParticipant | null = null;
  let curY = 0;
  for (; i < all.length; i++) {
    const r = all[i];
    const t = join(r.words);
    if (/^Name \(ohne Titel\)/.test(t)) continue;
    const firstW = r.words[0];
    // Ende der Liste: Gruppenüberschrift, Punktnummer oder Endtext
    if (r.words.some((w) => CODE.test(w.s) && w.x < Z.L) || (firstW.bold && firstW.size >= 11.5) || /^Endtext/.test(t) || /^Starttext/.test(t)) break;
    if (firstW.bold && firstW.size >= 9.5 && firstW.x < 45) {
      company = t;
      cur = null;
      continue;
    }
    if (firstW.size < 8.6) {
      const nameW = r.words.filter((w) => w.x < 190);
      const roleW = r.words.filter((w) => w.x >= 190 && w.x < 290);
      const phoneW = r.words.filter((w) => w.x >= 290 && w.x < 378);
      const mailW = r.words.filter((w) => w.x >= 378 && w.x < 500);
      if (nameW.length && nameW[0].x >= 45 && nameW[0].x < 60) {
        cur = { company, name: join(nameW), role: join(roleW), phone: join(phoneW), email: join(mailW, '') };
        curY = r.y;
        participants.push(cur);
      } else if (cur && r.y - curY < 16) {
        // Fortsetzungszeile (Umbruch in Gewerk/E-Mail/Name)
        if (nameW.length) cur.name = (cur.name.endsWith('-') ? cur.name : cur.name + ' ') + join(nameW);
        if (roleW.length) cur.role = (cur.role + ' ' + join(roleW)).trim();
        if (mailW.length) cur.email += join(mailW, '');
        curY = r.y;
      }
    }
  }
  for (const p of participants) p.name = p.name.replace(/-\s+/g, '-');

  // ---------------- Punkte ----------------
  const items: BmItem[] = [];
  let group = '';
  let it: BmItem | null = null;
  let entry: BmEntry | null = null;
  let lastLabel = '';
  let lastLabelY = 0;
  let lastLabelPage = -1;
  let titleOpen = false;
  let photos = false;
  let prevLine: { y: number; page: number; x: number; text: string } | null = null;

  const newEntry = (date: string, italic: boolean) => {
    entry = { date, italic, blocks: [] };
    it!.entries.push(entry);
    prevLine = null;
  };
  const addLine = (ws: PdfWord[], r: Row) => {
    if (!it) return;
    if (!entry) newEntry(it.created || iso(datum), false);
    const e = entry!;
    const x = ws[0].x;
    const level = x >= 122 ? 2 : x >= 111 ? 1 : 0;
    const runs: BmRun[] = [];
    let x2 = -1;
    let prevS = '';
    for (const w of ws) {
      const last = runs[runs.length - 1];
      const sp = last && needsSpace(prevS, w.x - x2) ? ' ' : '';
      x2 = w.x + w.w;
      prevS = w.s;
      if (last && !!last.bold === w.bold && !!last.italic === w.italic) last.text += sp + w.s;
      else runs.push({ text: sp + w.s, bold: w.bold || undefined, italic: w.italic || undefined });
    }
    const lineText = join(ws);
    const gap = prevLine && prevLine.page === r.page ? r.y - prevLine.y : 99;
    const lastBlock = e.blocks[e.blocks.length - 1];
    let cont = false;
    if (lastBlock && prevLine) {
      if (level === 0 && lastBlock.kind === 'p' && gap < 15) cont = true;
      if (level > 0 && lastBlock.kind === 'li' && lastBlock.level === level) {
        const lower = /^[a-zäöüß(]/.test(lineText);
        const ended = /[.!?:;]$/.test(prevLine.text);
        cont = gap < 15 && (lower || (gap < 11.3 && !ended));
      }
    }
    if (cont) {
      // Zeilenumbruch nach Bindestrich: ohne Leerzeichen verbinden (Bindestrich bleibt)
      const joiner = /-$/.test(prevLine!.text) ? '' : ' ';
      runs[0].text = joiner + runs[0].text.trimStart();
      lastBlock.runs.push(...runs);
    } else {
      runs[0].text = runs[0].text.trimStart();
      e.blocks.push({ kind: level ? 'li' : 'p', level: Math.max(1, level), runs });
    }
    prevLine = { y: r.y, page: r.page, x, text: lineText };
  };

  for (const r of all.slice(Math.max(i, 0))) {
    const t = join(r.words);
    if (/^Endtext\b/.test(t) || /^Nächste Besprechung/.test(t)) {
      if (it || items.length) break;
      continue;
    }
    const L = r.words.filter((w) => w.x < Z.L);
    const M = r.words.filter((w) => w.x >= Z.L && w.x < Z.M);
    const K = r.words.filter((w) => w.x >= Z.M && w.x < Z.K);
    const V = r.words.filter((w) => w.x >= Z.K);

    // Gruppenüberschrift (Zusatzfeld)
    if (L.length && L[0].size >= 11.5 && L[0].x < 45 && !M.length) {
      group = join(L);
      continue;
    }
    // neue Punktnummer
    const codeW = L.find((w) => CODE.test(w.s));
    if (codeW) {
      it = { code: codeW.s, title: '', status: 'info', group: group || undefined, fields: {}, entries: [], hasPhotos: false };
      items.push(it);
      entry = null;
      photos = false;
      titleOpen = false;
      lastLabel = '';
      prevLine = null;
      const vt = join(V);
      if (/offen/i.test(vt)) it.status = 'offen';
      else if (/erledigt/i.test(vt)) it.status = 'erledigt';
      const mt = join(M);
      const due = /fällig\s+(\d{2}\.\d{2}\.\d{4})(?:\s*bis\s*(\d{2}\.\d{2}\.\d{4}))?/.exec(mt);
      if (due) {
        if (due[2]) {
          it.dueFrom = iso(due[1]);
          it.dueTo = iso(due[2]);
        } else it.dueTo = iso(due[1]);
        if (it.status === 'info') it.status = 'offen';
      }
      continue;
    }
    if (!it) continue;

    if (/^Fotos\s*&\s*Daten/.test(t) || (L.length && /^Fotos$/.test(L[0].s) && /Daten/.test(t))) {
      photos = true;
      it.hasPhotos = true;
      continue;
    }

    // Felder rechts (Label klein in K, Wert in V)
    if (K.length && K[0].size < 8) {
      lastLabel = join(K);
      lastLabelY = r.y;
      lastLabelPage = r.page;
      if (V.length) it.fields[lastLabel] = join(V);
    } else if (V.length && lastLabel && lastLabelPage === r.page && r.y - lastLabelY < 24 && !K.length) {
      it.fields[lastLabel] = ((it.fields[lastLabel] || '') + ' ' + join(V)).trim();
      lastLabelY = r.y;
    }

    if (photos) continue; // Fotonummern / Bildtexte überspringen

    // Datum + Titel
    const dW = L.find((w) => DATE.test(w.s) && w.x < 60);
    if (dW && !it.created) {
      it.created = iso(dW.s);
      if (M.length) {
        it.title = join(M);
        titleOpen = true;
      }
      continue;
    }
    if (!M.length) continue;
    const mt = join(M);
    const anm = /^An[mn]\.\s*(\d{2}\.\d{2}\.\d{4})\s*:?\s*(.*)$/.exec(mt);
    if (anm) {
      titleOpen = false;
      newEntry(iso(anm[1]), M[0].italic);
      if (anm[2]) {
        const rest = M.filter((w) => !/^An[mn]\.$/.test(w.s) && !DATE.test(w.s) && w.s !== ':');
        if (rest.length) addLine(rest, r);
      }
      continue;
    }
    // mehrzeiliger Titel (fett, direkt unter dem Titel)
    if (titleOpen && M.every((w) => w.bold) && !entry && M[0].x < 111) {
      it.title += ' ' + mt;
      continue;
    }
    titleOpen = false;
    addLine(M, r);
  }

  if (!items.length) warnings.push('Keine Protokollpunkte erkannt.');
  if (!code) warnings.push('Protokollnummer nicht erkannt.');

  return {
    projectTitle,
    projectAddress,
    clientName: agRows[0] || '',
    clientAddress: agRows.slice(1).filter(Boolean).join(', '),
    typeName,
    code,
    prefix,
    seq,
    title: bez.join(' ').trim(),
    date: iso(datum),
    timeFrom: um?.[1] || '',
    timeTo: um?.[2] || '',
    location: ort.join(' ').trim(),
    sentAt: iso(versendet) || undefined,
    closed: /abgeschlossen/i.test(status),
    nextMeeting: nmm ? { date: iso(nmm[1]), timeFrom: nmm[2], timeTo: nmm[3] } : undefined,
    participants,
    items,
    warnings,
  };
}

/** Blöcke → TipTap-JSON */
export function bmBlocksToRichText(blocks: BmBlock[]): any {
  const merge = (runs: BmRun[]) =>
    runs.reduce<BmRun[]>((acc, r) => {
      const l = acc[acc.length - 1];
      if (l && !!l.bold === !!r.bold && !!l.italic === !!r.italic) l.text += r.text;
      else acc.push({ ...r });
      return acc;
    }, []);
  const para = (b: BmBlock) => ({
    type: 'paragraph',
    content: merge(b.runs)
      .filter((r) => r.text)
      .map((r) => {
        const marks = [...(r.bold ? [{ type: 'bold' }] : []), ...(r.italic ? [{ type: 'italic' }] : [])];
        return marks.length ? { type: 'text', text: r.text, marks } : { type: 'text', text: r.text };
      }),
  });
  const content: any[] = [];
  let k = 0;
  while (k < blocks.length) {
    const b = blocks[k];
    if (b.kind === 'p') {
      content.push(para(b));
      k++;
      continue;
    }
    // Liste (Ebene 1 mit verschachtelter Ebene 2)
    const list: any = { type: 'bulletList', content: [] };
    while (k < blocks.length && blocks[k].kind === 'li') {
      const li = blocks[k];
      if (li.level >= 2 && list.content.length) {
        const parent = list.content[list.content.length - 1];
        let sub = parent.content.find((c: any) => c.type === 'bulletList');
        if (!sub) parent.content.push((sub = { type: 'bulletList', content: [] }));
        sub.content.push({ type: 'listItem', content: [para(li)] });
      } else list.content.push({ type: 'listItem', content: [para(li)] });
      k++;
    }
    content.push(list);
  }
  return { type: 'doc', content };
}
