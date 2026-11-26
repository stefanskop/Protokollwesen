// Testet den Baumaster-Import an PDF-Dateien: npx tsx tools/bm-test.ts datei.pdf [--full]
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import fs from 'node:fs';
import { parseBaumaster, type PdfPage } from '../shared/src/baumaster';

async function extract(file: string): Promise<PdfPage[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)) }).promise;
  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    await page.getOperatorList();
    const tc = await page.getTextContent();
    const font = (n: string) => { try { return (page.commonObjs.get(n) as any)?.name || ''; } catch { return ''; } };
    pages.push({ width: vp.width, height: vp.height, words: tc.items.filter((i: any) => i.str?.trim()).map((i: any) => {
      const fn = font(i.fontName);
      return { x: i.transform[4], y: vp.height - i.transform[5], w: i.width, s: i.str, size: Math.abs(i.transform[0]), bold: /bold|semibold|black/i.test(fn), italic: /italic|oblique/i.test(fn) };
    }) });
  }
  return pages;
}
const file = process.argv[2];
const r = parseBaumaster(await extract(file));
const full = process.argv.includes('--full');
console.log(JSON.stringify({ ...r, participants: full ? r.participants : r.participants.slice(0, 4).concat([`… ${r.participants.length} gesamt` as any]), items: full ? r.items : r.items.slice(0, 3) }, null, 1).slice(0, full ? 1e6 : 6000));
console.log('Punkte:', r.items.length, '| offen:', r.items.filter((i) => i.status === 'offen').length, '| Beteiligte:', r.participants.length, '| Codes:', r.items.map((i) => i.code).join(' '));
