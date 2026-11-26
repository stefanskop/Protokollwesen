// Text mit Positionen und Schriftschnitt aus einer PDF-Datei lesen (läuft im Browser, auch offline)
import type { PdfPage } from '../../shared/src/baumaster';

let lib: Promise<any> | null = null;
export async function pdfjs() {
  if (!lib) {
    lib = (async () => {
      const m: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
      m.GlobalWorkerOptions.workerSrc = worker;
      return m;
    })();
  }
  return lib;
}

export async function extractPdf(data: ArrayBuffer): Promise<PdfPage[]> {
  const m = await pdfjs();
  const doc = await m.getDocument({ data: new Uint8Array(data) }).promise;
  const pages: PdfPage[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    await page.getOperatorList(); // lädt die Schriften (für fett/kursiv)
    const tc = await page.getTextContent();
    const font = (n: string) => {
      try {
        return (page.commonObjs.get(n) as any)?.name || '';
      } catch {
        return '';
      }
    };
    pages.push({
      width: vp.width,
      height: vp.height,
      words: tc.items
        .filter((i: any) => i.str?.trim())
        .map((i: any) => {
          const fn = font(i.fontName);
          return {
            x: i.transform[4],
            y: vp.height - i.transform[5],
            w: i.width,
            s: i.str,
            size: Math.abs(i.transform[0]),
            bold: /bold|semibold|black|heavy/i.test(fn),
            italic: /italic|oblique/i.test(fn),
          };
        }),
    });
    page.cleanup();
  }
  await doc.destroy();
  return pages;
}
