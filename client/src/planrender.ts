// Pläne (PDF oder Bild) darstellen und Planausschnitte für das Protokoll-PDF erzeugen
import { getBlob } from './sync';
import { pdfjs } from './pdfextract';
import type { PlanMarker } from '../../shared/src/index';

type Loaded = { kind: 'pdf'; doc: any; pages: number } | { kind: 'img'; img: HTMLImageElement; pages: 1 };
const cache = new Map<string, Promise<Loaded>>();

export function loadPlan(fileId: string, mime: string): Promise<Loaded> {
  let p = cache.get(fileId);
  if (!p) {
    p = (async () => {
      const blob = await getBlob(fileId);
      if (!blob) throw new Error('Plan nicht verfügbar (offline noch nicht geladen?)');
      if (mime === 'application/pdf' || blob.type === 'application/pdf') {
        const m = await pdfjs();
        const doc = await m.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        return { kind: 'pdf', doc, pages: doc.numPages } as Loaded;
      }
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.src = url;
      await img.decode();
      return { kind: 'img', img, pages: 1 } as Loaded;
    })();
    cache.set(fileId, p);
    p.catch(() => cache.delete(fileId));
  }
  return p;
}

/** Seite in ein Canvas zeichnen; Breite in Pixel */
export async function renderPlanPage(fileId: string, mime: string, page: number, canvas: HTMLCanvasElement, width: number) {
  const l = await loadPlan(fileId, mime);
  const ctx = canvas.getContext('2d')!;
  if (l.kind === 'img') {
    const s = width / l.img.naturalWidth;
    canvas.width = Math.round(l.img.naturalWidth * s);
    canvas.height = Math.round(l.img.naturalHeight * s);
    ctx.drawImage(l.img, 0, 0, canvas.width, canvas.height);
    return;
  }
  const pg = await l.doc.getPage(page);
  const vp1 = pg.getViewport({ scale: 1 });
  const vp = pg.getViewport({ scale: width / vp1.width });
  canvas.width = Math.round(vp.width);
  canvas.height = Math.round(vp.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
}

export function drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, label?: string) {
  ctx.save();
  ctx.fillStyle = '#e53935';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = r / 4;
  ctx.beginPath();
  ctx.arc(x, y - r * 1.6, r, Math.PI, 0);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(x, y - r * 1.6, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  if (label) {
    ctx.font = `bold ${r * 1.1}px sans-serif`;
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(x + r * 1.2, y - r * 2.3, w + r * 0.8, r * 1.5);
    ctx.fillStyle = '#b00045';
    ctx.fillText(label, x + r * 1.6, y - r * 1.55);
  }
  ctx.restore();
}

/** Ausschnitt rund um einen Marker als JPEG-dataURL */
export async function planSnippet(fileId: string, mime: string, m: PlanMarker, label?: string): Promise<string> {
  const full = document.createElement('canvas');
  await renderPlanPage(fileId, mime, m.page, full, 2400);
  const W = 900;
  const H = 560;
  const cx = m.x * full.width;
  const cy = m.y * full.height;
  const sx = Math.max(0, Math.min(full.width - W, cx - W / 2));
  const sy = Math.max(0, Math.min(full.height - H, cy - H / 2));
  const out = document.createElement('canvas');
  out.width = Math.min(W, full.width);
  out.height = Math.min(H, full.height);
  const ctx = out.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(full, sx, sy, out.width, out.height, 0, 0, out.width, out.height);
  drawPin(ctx, cx - sx, cy - sy, 16, label);
  ctx.strokeStyle = '#999';
  ctx.strokeRect(0.5, 0.5, out.width - 1, out.height - 1);
  return out.toDataURL('image/jpeg', 0.85);
}
