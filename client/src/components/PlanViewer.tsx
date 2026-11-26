import { useEffect, useRef, useState } from 'react';
import { renderPlanPage, loadPlan } from '../planrender';
import { fmtDate, type Plan, type PlanMarker } from '../../../shared/src/index';

export interface ViewerMarker {
  marker: PlanMarker;
  label: string;
  title?: string;
  itemId?: string;
  highlight?: boolean;
}

/** Vollbild-Planansicht mit Zoom, Seitenwahl und Markern; optional Marker setzen */
export function PlanViewer({
  plan,
  fileId,
  mime,
  versionLabel,
  markers = [],
  placeLabel,
  onPlace,
  onMarkerClick,
  onClose,
}: {
  plan: Plan;
  fileId?: string;
  mime?: string;
  versionLabel?: string;
  markers?: ViewerMarker[];
  placeLabel?: string;
  onPlace?: (m: PlanMarker) => void;
  onMarkerClick?: (m: ViewerMarker) => void;
  onClose: () => void;
}) {
  const fid = fileId || plan.fileId;
  const fmime = mime || plan.mime;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(markers.find((m) => m.highlight)?.marker.page || 1);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState('');
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    loadPlan(fid, fmime)
      .then((l) => setPages(l.pages))
      .catch((e) => setErr(e.message));
  }, [fid]);

  useEffect(() => {
    if (!canvas.current || !box.current) return;
    let stop = false;
    setBusy(true);
    const w = Math.min(6000, Math.round((box.current.clientWidth - 20) * zoom * (window.devicePixelRatio > 1 ? 1.5 : 1)));
    renderPlanPage(fid, fmime, page, canvas.current, w)
      .then(() => {
        if (stop) return;
        const css = (box.current!.clientWidth - 20) * zoom;
        setSize({ w: css, h: (canvas.current!.height / canvas.current!.width) * css });
        setBusy(false);
      })
      .catch((e) => setErr(e.message));
    return () => {
      stop = true;
    };
  }, [fid, page, zoom]);

  // zum hervorgehobenen Marker scrollen
  useEffect(() => {
    const h = markers.find((m) => m.highlight && m.marker.page === page);
    if (!h || !box.current || !size.w) return;
    box.current.scrollTo({ left: h.marker.x * size.w - box.current.clientWidth / 2, top: h.marker.y * size.h - box.current.clientHeight / 2 });
  }, [size.w]);

  const click = (e: React.MouseEvent) => {
    if (!onPlace) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onPlace({ planId: plan.id, page, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <div className="viewer-bg">
      <div className="viewer-bar">
        <b className="viewer-title">
          {plan.name} {(versionLabel ?? plan.index) && <span className="badge">Index {versionLabel ?? plan.index}</span>}{' '}
          {plan.planDate && <span className="muted small">{fmtDate(plan.planDate)}</span>}
        </b>
        {onPlace && <span className="badge orange">📍 {placeLabel || 'In den Plan tippen, um den Marker zu setzen'}</span>}
        <div className="grow" />
        {pages > 1 && (
          <>
            <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ◀
            </button>
            <span className="small">
              Seite {page}/{pages}
            </span>
            <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              ▶
            </button>
          </>
        )}
        <button className="btn small" onClick={() => setZoom(Math.max(0.5, zoom / 1.5))} title="Verkleinern">
          −
        </button>
        <span className="small">{Math.round(zoom * 100)} %</span>
        <button className="btn small" onClick={() => setZoom(Math.min(8, zoom * 1.5))} title="Vergrößern">
          +
        </button>
        <button className="btn small" onClick={() => setZoom(1)}>
          Einpassen
        </button>
        <button className="btn primary small" onClick={onClose}>
          Schließen
        </button>
      </div>
      <div className="viewer-stage" ref={box}>
        {err && <div className="notice red">{err}</div>}
        <div className="viewer-sheet" style={{ width: size.w || undefined, height: size.h || undefined, cursor: onPlace ? 'crosshair' : 'default' }} onClick={click}>
          <canvas ref={canvas} style={{ width: '100%', height: '100%', opacity: busy ? 0.4 : 1 }} />
          {markers
            .filter((m) => m.marker.page === page)
            .map((m, k) => (
              <button
                key={k}
                className={'pin' + (m.highlight ? ' hl' : '')}
                style={{ left: `${m.marker.x * 100}%`, top: `${m.marker.y * 100}%` }}
                title={m.title || m.label}
                onClick={(e) => {
                  e.stopPropagation();
                  onMarkerClick?.(m);
                }}
              >
                <span>{m.label}</span>
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
