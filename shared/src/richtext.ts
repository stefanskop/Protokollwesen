import type { RichText } from './model';

type Run = { text: string; bold?: boolean; italics?: boolean; decoration?: string; color?: string; background?: string; link?: string };

const HEADING_SIZE: Record<number, number> = { 1: 13, 2: 11.5, 3: 10 };

function runs(nodes: any[] | undefined, base: Partial<Run> = {}): Run[] {
  const out: Run[] = [];
  for (const n of nodes || []) {
    if (n.type === 'text') {
      const r: Run = { text: n.text, ...base };
      for (const m of n.marks || []) {
        if (m.type === 'bold') r.bold = true;
        if (m.type === 'italic') r.italics = true;
        if (m.type === 'underline') r.decoration = 'underline';
        if (m.type === 'strike' && r.decoration !== 'underline') r.decoration = 'lineThrough';
        if (m.type === 'textStyle' && m.attrs?.color) r.color = m.attrs.color;
        if (m.type === 'highlight') r.background = m.attrs?.color || '#fff59d';
        if (m.type === 'link' && m.attrs?.href) {
          r.link = m.attrs.href;
          r.color = r.color || '#2f8fc5';
        }
      }
      out.push(r);
    } else if (n.type === 'hardBreak') {
      out.push({ text: '\n', ...base });
    }
  }
  return out;
}

function align(n: any) {
  const a = n.attrs?.textAlign;
  return a && a !== 'left' ? { alignment: a } : {};
}

function block(n: any, base: Partial<Run>): any {
  switch (n.type) {
    case 'paragraph':
      return { text: n.content ? runs(n.content, base) : ' ', margin: [0, 0, 0, 3], ...align(n) };
    case 'heading':
      return { text: runs(n.content, { ...base, bold: true }), fontSize: HEADING_SIZE[n.attrs?.level] || 10, margin: [0, 3, 0, 3], ...align(n) };
    case 'bulletList':
      return { ul: (n.content || []).map((li: any) => listItem(li, base)), margin: [0, 0, 0, 3] };
    case 'orderedList':
      return { ol: (n.content || []).map((li: any) => listItem(li, base)), start: n.attrs?.start || 1, margin: [0, 0, 0, 3] };
    default:
      return n.content ? { stack: n.content.map((c: any) => block(c, base)) } : { text: '' };
  }
}

function listItem(li: any, base: Partial<Run>) {
  const parts = (li.content || []).map((c: any) => block(c, base));
  parts.forEach((p: any) => (p.margin = [0, 0, 0, 1]));
  return parts.length === 1 ? parts[0] : { stack: parts };
}

/** wandelt TipTap-JSON in pdfmake-Inhalt um */
export function richTextToPdf(doc: RichText, italic = false): any[] {
  const base = italic ? { italics: true } : {};
  if (!doc || !doc.content) return [];
  return doc.content.map((n) => block(n, base));
}

/** Klartext (für Suche, Vorschau, Import) */
export function richTextToPlain(doc: RichText): string {
  const walk = (n: any): string => {
    if (n.type === 'text') return n.text;
    if (n.type === 'hardBreak') return '\n';
    return (n.content || []).map(walk).join(n.type === 'doc' || n.type.endsWith('List') ? '\n' : '');
  };
  return doc ? walk(doc) : '';
}

/** Klartext → einfaches TipTap-Dokument */
export function plainToRichText(text: string): RichText {
  const paras = text.split(/\n/);
  return {
    type: 'doc',
    content: paras.map((p) => (p ? { type: 'paragraph', content: [{ type: 'text', text: p }] } : { type: 'paragraph' })),
  };
}
