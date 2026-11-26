// Zeichnen / Markieren in Fotos und Plänen.
// Das Original bleibt unverändert; gespeichert wird ein neues Bild (mit Skizze) plus
// die Zeichnung als Vektordaten, damit sie später weiter bearbeitet werden kann.
import { useEffect, useRef, useState } from 'react';
import { getBlob } from '../sync';
import { addFile } from '../data';
import { save, getRec } from '../db';
import type { FileMeta } from '../../../shared/src/index';

type Pt = [number, number];
export type Shape =
  | { t: 'pen'; c: string; w: number; pts: Pt[] }
  | { t: 'arrow' | 'line' | 'rect' | 'ellipse'; c: string; w: number; a: Pt; b: Pt }
  | { t: 'text'; c: string; w: number; a: Pt; text: string };
type Tool = Shape['t'];

const COLORS = ['#e53935', '#ffd600', '#00c853', '#2979ff', '#000000', '#ffffff'];
const TOOLS: { t: Tool; label: string; title: string }[] = [
  { t: 'pen', label: '✎', title: 'Freihand' },
  { t: 'arrow', label: '➚', title: 'Pfeil' },
  { t: 'line', label: '╱', title: 'Linie' },
  { t: 'rect', label: '▭', title: 'Rechteck' },
  { t: 'ellipse', label: '◯', title: 'Kreis / Ellipse' },
  { t: 'text', label: 'T', title: 'Text' },
];

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], base: number) {
  for (const s of shapes) {
    const w = s.w * base;
    ctx.strokeStyle = s.c;
    ctx.fillStyle = s.c;
    ctx.lineWidth = w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (s.t === 'pen') {
      s.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    } else if (s.t === 'line' || s.t === 'arrow') {
      ctx.moveTo(...s.a);
      ctx.lineTo(...s.b);
      ctx.stroke();
      if (s.t === 'arrow') {
        const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
        const len = w * 6;
        ctx.beginPath();
        ctx.moveTo(...s.b);
        ctx.lineTo(s.b[0] - len * Math.cos(ang - 0.45), s.b[1] - len * Math.sin(ang - 0.45));
        ctx.lineTo(s.b[0] - len * Math.cos(ang + 0.45), s.b[1] - len * Math.sin(ang + 0.45));
        ctx.closePath();
        ctx.fill();
      }
    } else if (s.t === 'rect') {
      ctx.strokeRect(Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.abs(s.b[0] - s.a[0]), Math.abs(s.b[1] - s.a[1]));
    } else if (s.t === 'ellipse') {
      ctx.ellipse((s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2, Math.abs(s.b[0] - s.a[0]) / 2, Math.abs(s.b[1] - s.a[1]) / 2, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.t === 'text') {
      const size = w * 10;
      ctx.font = `bold ${size}px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textBaseline = 'top';
      // Kontur für Lesbarkeit auf jedem Hintergrund
      ctx.lineWidth = size / 6;
      ctx.strokeStyle = s.c === '#ffffff' || s.c === '#ffd600' ? '#000' : '#fff';
      s.text.split('\n').forEach((line, i) => {
        ctx.strokeText(line, s.a[0], s.a[1] + i * size * 1.2);
        ctx.fillText(line, s.a[0], s.a[1] + i * size * 1.2);
      });
    }
  }
}

async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/**
 * Öffnet den Zeichen-Editor für eine Bilddatei.
 * onSaved erhält die ID des neuen (gezeichneten) Bildes.
 */
export function SketchEditor({ fileId, projectId, onClose, onSaved }: { fileId: string; projectId: string; onClose: () => void; onSaved: (newId: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [origId, setOrigId] = useState(fileId);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [redo, setRedo] = useState<Shape[]>([]);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(3);
  const [draft, setDraft] = useState<Shape | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const base = useRef(1); // Linienstärke relativ zur Bildgröße

  // Original + vorhandene Skizze laden
  useEffect(() => {
    (async () => {
      const meta = await getRec<FileMeta>(fileId);
      const sk = meta?.sketch as { originalId: string; shapes: Shape[] } | undefined;
      const oid = sk?.originalId || fileId;
      const blob = await getBlob(oid);
      if (!blob) return setErr('Bild konnte nicht geladen werden.');
      try {
        const im = await loadImage(blob);
        base.current = Math.max(im.naturalWidth, im.naturalHeight) / 1000;
        setOrigId(oid);
        setShapes(sk?.shapes || []);
        setImg(im);
      } catch {
        setErr('Bildformat wird nicht unterstützt.');
      }
    })();
  }, [fileId]);

  // Zeichnen
  useEffect(() => {
    const c = canvas.current;
    if (!c || !img) return;
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    drawShapes(ctx, draft ? [...shapes, draft] : shapes, base.current);
  }, [img, shapes, draft]);

  const pos = (e: React.PointerEvent): Pt => {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height];
  };
  const down = (e: React.PointerEvent) => {
    if (!img) return;
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const p = pos(e);
    if (tool === 'text') {
      const text = prompt('Text eingeben');
      if (text) {
        setShapes([...shapes, { t: 'text', c: color, w: width, a: p, text }]);
        setRedo([]);
      }
      return;
    }
    setDraft(tool === 'pen' ? { t: 'pen', c: color, w: width, pts: [p] } : { t: tool, c: color, w: width, a: p, b: p });
  };
  const move = (e: React.PointerEvent) => {
    if (!draft) return;
    const p = pos(e);
    setDraft(draft.t === 'pen' ? { ...draft, pts: [...draft.pts, p] } : { ...(draft as any), b: p });
  };
  const up = () => {
    if (!draft) return;
    const tiny = draft.t !== 'pen' && draft.t !== 'text' && Math.hypot(draft.b[0] - draft.a[0], draft.b[1] - draft.a[1]) < 4;
    if (!tiny) {
      setShapes([...shapes, draft]);
      setRedo([]);
    }
    setDraft(null);
  };

  const store = async () => {
    if (!canvas.current) return;
    setBusy(true);
    try {
      const blob: Blob = await new Promise((res, rej) => canvas.current!.toBlob((b) => (b ? res(b) : rej(new Error('Export fehlgeschlagen'))), 'image/jpeg', 0.88));
      const origMeta = await getRec<FileMeta>(origId);
      const name = (origMeta?.name || 'Foto').replace(/(_skizze)?\.[^.]+$/, '') + '_skizze.jpg';
      const newId = await addFile(new File([blob], name, { type: 'image/jpeg' }), projectId, name);
      await save<FileMeta>('file', newId, { sketch: { originalId: origId, shapes }, caption: origMeta?.caption || '' } as any);
      onSaved(newId);
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sketch-bg">
      <div className="sketch-bar">
        {TOOLS.map((t) => (
          <button key={t.t} className={'sk-btn' + (tool === t.t ? ' on' : '')} title={t.title} onClick={() => setTool(t.t)}>
            {t.label}
          </button>
        ))}
        <span className="sk-sep" />
        {COLORS.map((c) => (
          <button key={c} className={'sk-color' + (color === c ? ' on' : '')} style={{ background: c }} title="Farbe" onClick={() => setColor(c)} />
        ))}
        <span className="sk-sep" />
        <select value={width} onChange={(e) => setWidth(Number(e.target.value))} title="Strichstärke">
          <option value={2}>dünn</option>
          <option value={3}>mittel</option>
          <option value={5}>dick</option>
          <option value={8}>sehr dick</option>
        </select>
        <span className="sk-sep" />
        <button className="sk-btn" title="Rückgängig" disabled={!shapes.length} onClick={() => (setRedo([shapes[shapes.length - 1], ...redo]), setShapes(shapes.slice(0, -1)))}>
          ↶
        </button>
        <button className="sk-btn" title="Wiederholen" disabled={!redo.length} onClick={() => (setShapes([...shapes, redo[0]]), setRedo(redo.slice(1)))}>
          ↷
        </button>
        <button className="sk-btn" title="Alles löschen" disabled={!shapes.length} onClick={() => confirm('Alle Markierungen entfernen?') && (setShapes([]), setRedo([]))}>
          🗑
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>
          Abbrechen
        </button>
        <button className="btn primary" disabled={busy || !img} onClick={store}>
          {busy ? 'Speichere…' : 'Speichern'}
        </button>
      </div>
      <div className="sketch-stage">
        {err && <div className="notice red">{err}</div>}
        {!img && !err && <div className="empty" style={{ color: '#ddd' }}>Bild wird geladen…</div>}
        <canvas ref={canvas} style={{ display: img ? 'block' : 'none' }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
      </div>
    </div>
  );
}
