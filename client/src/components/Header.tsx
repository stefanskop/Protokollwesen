// Kopfzeile + Reiterleiste im Stil der Kostenverfolgung
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useProjects, useProjectData } from '../data';
import { useUser, SyncBadge } from '../App';
import { kostenUrl } from './ProjectTabs';

type Tab = { key: string; to: string; label: string; icon: string; color: string; count?: number; external?: boolean };

export function Header() {
  const loc = useLocation();
  const nav = useNavigate();
  const user = useUser();
  const m = /^\/p\/([^/]+)(?:\/([^/]+))?/.exec(loc.pathname);
  const pid = m?.[1];
  const sub = m?.[2] || '';
  const { projects } = useProjects();
  const project = pid ? projects.find((p) => p.id === pid) : undefined;
  const d = useProjectData(pid);

  const openDefects = d.items.filter((i) => i.defect && (i.status === 'offen' || i.status === 'behoben')).length;
  const tabs: Tab[] = project
    ? [
        { key: 'projekt', to: `/p/${pid}/projekt`, label: '00 Projektdaten', icon: 'fa-sliders', color: 'ic-amber' },
        { key: '', to: `/p/${pid}`, label: '01 Protokolle', icon: 'fa-clipboard-list', color: 'ic-sky', count: d.protocols.length },
        { key: 'plaene', to: `/p/${pid}/plaene`, label: '02 Pläne', icon: 'fa-map', color: 'ic-emerald', count: d.plans.length },
        { key: 'maengel', to: `/p/${pid}/maengel`, label: '03 Mängel', icon: 'fa-triangle-exclamation', color: 'ic-rose', count: openDefects },
        { key: 'kosten', to: kostenUrl(project), label: '04 Kosten', icon: 'fa-coins', color: 'ic-amber2', external: true },
        { key: 'einstellungen', to: `/p/${pid}/einstellungen`, label: '05 Einstellungen', icon: 'fa-gear', color: 'ic-slate' },
      ]
    : [
        { key: '/', to: '/', label: 'Projekte', icon: 'fa-folder-open', color: 'ic-amber', count: projects.filter((p) => !p.archived).length },
        { key: '/kontakte', to: '/kontakte', label: 'Firmen & Kontakte', icon: 'fa-address-book', color: 'ic-sky' },
        { key: '/import', to: '/import', label: 'Import aus Baumaster', icon: 'fa-file-import', color: 'ic-emerald' },
        { key: '/einstellungen', to: '/einstellungen', label: 'Einstellungen', icon: 'fa-gear', color: 'ic-slate' },
      ];
  const isActive = (t: Tab) => (project ? sub === t.key || (t.key === '' && sub === 'protokoll') : loc.pathname === t.key);

  return (
    <header className="hdr">
      <div className="hdr-top">
        <Link to="/" className="hdr-logo" title="Projekte">
          <img src="/logo.png" alt="Skop Bauconsulting" />
        </Link>
        {project ? (
          <div className="hdr-proj" onClick={() => nav('/')} title="Projekt wechseln">
            <div className="hdr-line1">
              {project.number && <span className="hdr-nr">{project.number}</span>}
              <h1>{project.name}</h1>
            </div>
            <p className="hdr-line2">
              <span>
                <i className="fa-regular fa-building" /> AG: <strong>{project.clientName || '–'}</strong>
              </span>
              <span className="sep">|</span>
              <span>
                <i className="fa-solid fa-location-dot" /> {project.address || '–'}
              </span>
              <span className="sep">|</span>
              <span>
                <i className="fa-solid fa-user" /> Benutzer: <strong className="amber">{user.name}</strong>
              </span>
            </p>
          </div>
        ) : (
          <div className="hdr-proj">
            <div className="hdr-line1">
              <h1>Projektmanagement</h1>
            </div>
            <p className="hdr-line2">
              <span>Besprechungsprotokolle, Pläne, Mängel &amp; Baudokumentation</span>
              <span className="sep">|</span>
              <span>
                <i className="fa-solid fa-user" /> Benutzer: <strong className="amber">{user.name}</strong>
              </span>
            </p>
          </div>
        )}
        <div className="grow" />
        <div className="hdr-actions">
          <SyncBadge />
          <Link className="hbtn" to="/kontakte" title="Firmen & Kontakte">
            <i className="fa-solid fa-address-book" />
            <span>Kontakte</span>
          </Link>
          <a className="hbtn" href="/kosten/" title="Kostenverfolgung (alle Projekte)">
            <i className="fa-solid fa-coins" />
            <span>Kosten</span>
          </a>
          <Link className="hbtn" to="/" title="Projektliste">
            <i className="fa-solid fa-house" />
            <span>Start</span>
          </Link>
        </div>
      </div>
      <nav className="hdr-tabs">
        {tabs.map((t) => {
          const inner = (
            <>
              <i className={`fa-solid ${t.icon} ${t.color}`} />
              <span>{t.label}</span>
              {t.count !== undefined && <span className="tab-cnt">{t.count}</span>}
            </>
          );
          return t.external ? (
            <a key={t.key} className="tab-btn" href={t.to} title="Kostenverfolgung dieses Projekts">
              {inner}
              <i className="fa-solid fa-arrow-up-right-from-square ext" />
            </a>
          ) : (
            <Link key={t.key} className={'tab-btn' + (isActive(t) ? ' on' : '')} to={t.to}>
              {inner}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
