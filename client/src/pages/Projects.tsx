import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ldb } from '../db';
import { api, clearLogin, storeLogin } from '../api';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '../data';
import { save } from '../db';
import { Modal } from '../components/ui';
import { useUser, SyncBadge } from '../App';
import type { Project, UserInfo } from '../../../shared/src/index';

export function ProjectsPage() {
  const { projects, loaded } = useProjects();
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(() => {
    const neu = new URLSearchParams(window.location.search).has('neu');
    if (neu) window.history.replaceState(null, '', '/');
    return neu;
  });
  const nav = useNavigate();
  const user = useUser();
  // Kennzahlen je Projekt (lokal, funktioniert auch offline)
  const stats = useLiveQuery(async () => {
    const m = new Map<string, { protocols: number; open: number; changed: string }>();
    const recs = await ldb.records.where('type').anyOf(['protocol', 'item', 'project']).toArray();
    for (const r of recs) {
      if (r.deleted || !r.projectId) continue;
      const s0 = m.get(r.projectId) || { protocols: 0, open: 0, changed: '' };
      if (r.type === 'protocol') s0.protocols++;
      if (r.type === 'item' && ['offen', 'behoben'].includes((r as any).status)) s0.open++;
      if ((r.updatedAt || '') > s0.changed) s0.changed = r.updatedAt || '';
      m.set(r.projectId, s0);
    }
    return m;
  }, []);
  const ql = q.toLowerCase();
  const list = projects
    .filter((p) => p.archived === showArchived && (!q || `${p.number} ${p.name} ${p.address} ${p.clientName}`.toLowerCase().includes(ql)))
    .sort((a, b) => (stats?.get(b.id)?.changed || '').localeCompare(stats?.get(a.id)?.changed || ''));
  let last: string | null = null;
  try {
    last = localStorage.getItem('pw.lastProject');
  } catch {}
  const open = (id: string) => nav(`/p/${id}/projekt`);
  return (
    <div className="start-full">
      <div className="start-box">
        <div className="start-head">
          <div className="hdr-logo">
            <img src="/logo.png" alt="Skop Bauconsulting" />
          </div>
          <div>
            <div className="t">Projektmanagement</div>
            <div className="s">Protokolle, Kontakte, Pläne, Mängel &amp; Kosten · Skop Bauconsulting</div>
          </div>
        </div>
        <div className="start-grid">
          <UserCard />
          <div className="st-card2">
            <div className="st-h2">
              <i className="fa-solid fa-folder-open" /> 2. Projekt wählen
              <span className="who">
                angemeldet: <b>{user.name}</b>
              </span>
            </div>
            <div className="row" style={{ marginBottom: 10, alignItems: 'center' }}>
              <span className="search-in">
                <i className="fa-solid fa-magnifying-glass" />
                <input
                  placeholder="Projekt suchen (Nr., Name, Adresse, Auftraggeber) …"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && list[0] && open(list[0].id)}
                  autoFocus
                />
              </span>
              <label className="check" style={{ flex: '0 0 auto' }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivierte
              </label>
              <span className="muted small" style={{ flex: '0 0 auto' }}>
                {list.length} Projekte
              </span>
            </div>
            {loaded && !list.length && <div className="empty">{projects.length ? 'Keine Treffer.' : 'Noch keine Projekte. Legen Sie Ihr erstes Projekt an.'}</div>}
            {!!list.length && (
              <div className="tablewrap">
                <table className="list">
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>Nr.</th>
                      <th>Projekt</th>
                      <th>Auftraggeber</th>
                      <th className="c">Protokolle</th>
                      <th className="c">Offene Punkte</th>
                      <th>Zuletzt geändert</th>
                      <th style={{ width: 100 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => {
                      const st = stats?.get(p.id);
                      return (
                        <tr key={p.id} className="click" onClick={() => open(p.id)}>
                          <td>
                            <b>{p.number}</b>
                          </td>
                          <td>
                            <b>{p.name}</b> {p.id === last && <span className="badge">zuletzt</span>}
                            {p.address && <div className="muted small">{p.address}</div>}
                          </td>
                          <td className="small">{p.clientName}</td>
                          <td className="c">{st?.protocols || 0}</td>
                          <td className="c">{st?.open ? <span className="badge orange">{st.open}</span> : <span className="muted">0</span>}</td>
                          <td className="small">{st?.changed ? new Date(st.changed).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' }) : ''}</td>
                          <td>
                            <button className="btn small primary">
                              <i className="fa-solid fa-arrow-right" /> Öffnen
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn amber" style={{ flex: '0 0 auto' }} onClick={() => nav('/import')}>
                <i className="fa-solid fa-file-import" /> Projektimport
              </button>
              <button className="btn primary" style={{ flex: '0 0 auto' }} onClick={() => setCreating(true)}>
                <i className="fa-solid fa-folder-plus" /> Neues Projekt
              </button>
              <div style={{ flex: 1 }} />
              <a className="btn" style={{ flex: '0 0 auto' }} href="/kosten/">
                <i className="fa-solid fa-coins" /> Kostenverfolgung
              </a>
              <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => nav('/einstellungen')}>
                <i className="fa-solid fa-gear" /> Einstellungen
              </button>
            </div>
          </div>
        </div>
        <div className="start-note">
          <SyncBadge /> Angemeldet als <b>{user.name}</b> · Projekte werden automatisch auf dem Server (NAS) gespeichert und auf allen Geräten abgeglichen – auch offline nutzbar.
        </div>
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} onCreated={(id) => nav(`/p/${id}/projekt`)} />}
    </div>
  );
}

/** 1. Benutzer: angemeldeten Benutzer anzeigen und wechseln */
function UserCard() {
  const user = useUser();
  const [users, setUsers] = useState<UserInfo[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('pw.users') || '[]');
    } catch {
      return [];
    }
  });
  const [switchTo, setSwitchTo] = useState<UserInfo | null>(null);
  useEffect(() => {
    api<UserInfo[]>('/api/users')
      .then((u) => {
        const act = u.filter((x) => x.active);
        setUsers(act);
        try {
          localStorage.setItem('pw.users', JSON.stringify(act));
        } catch {}
      })
      .catch(() => {});
  }, []);
  const list = users.length ? users : [user];
  return (
    <div className="st-card2">
      <div className="st-h2">
        <i className="fa-solid fa-user-check" /> 1. Benutzer
      </div>
      <div className="st-users">
        {list.map((u) => (
          <button key={u.id} className={'st-u' + (u.id === user.id ? ' on' : '')} onClick={() => u.id !== user.id && setSwitchTo(u)} title={u.id === user.id ? 'angemeldet' : 'Benutzer wechseln'}>
            <i className={u.id === user.id ? 'fa-solid fa-circle-check' : 'fa-regular fa-user'} />
            <span>{u.name}</span>
            <span className="muted small">{u.role === 'admin' ? 'Admin' : 'Mitarbeiter'}</span>
          </button>
        ))}
      </div>
      <div className="muted small" style={{ marginTop: 10 }}>
        Zum Wechseln einen Benutzer anklicken und mit dessen Passwort anmelden. Neue Benutzer legen Administratoren unter Einstellungen → Benutzer an.
      </div>
      <button
        className="btn small"
        style={{ marginTop: 10 }}
        onClick={async () => {
          if (!confirm('Abmelden?')) return;
          try {
            await api('/api/logout', { method: 'POST' });
          } catch {}
          clearLogin();
          location.href = '/';
        }}
      >
        <i className="fa-solid fa-right-from-bracket" /> Abmelden
      </button>
      {switchTo && <SwitchUser target={switchTo} onClose={() => setSwitchTo(null)} />}
    </div>
  );
}

function SwitchUser({ target, onClose }: { target: UserInfo; onClose: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const go = async () => {
    try {
      const r = await api<{ token: string; user: UserInfo }>('/api/login', { body: { email: target.email, password: pw, device: 'Browser' } });
      storeLogin(r.token, r.user);
      location.href = '/';
    } catch (e: any) {
      setErr(e.status ? e.message : 'Server nicht erreichbar – Benutzerwechsel nur online möglich.');
    }
  };
  return (
    <Modal
      title={`Anmelden als ${target.name}`}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={go} disabled={!pw}>
            Anmelden
          </button>
        </>
      }
    >
      {err && <div className="notice red">{err}</div>}
      <label className="f">
        Passwort für {target.email}
        <input type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && go()} />
      </label>
    </Modal>
  );
}

function NewProject({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const user = useUser();
  const [p, setP] = useState({ number: '', name: '', address: '', clientName: '', clientAddress: '' });
  const f = (k: keyof typeof p) => ({ value: p[k], onChange: (e: any) => setP({ ...p, [k]: e.target.value }) });
  const create = async () => {
    const id = await save<Project>('project', null, { ...p, archived: false, memberUserIds: [user.id], participants: [] });
    onCreated(id);
  };
  return (
    <Modal
      title="Neues Projekt"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!p.name} onClick={create}>
            Anlegen
          </button>
        </>
      }
    >
      <div className="grid2">
        <label className="f">
          Projektnummer
          <input {...f('number')} placeholder="25031" />
        </label>
        <label className="f">
          Projektbezeichnung *
          <input {...f('name')} placeholder="S-PROM - Sparkasse Promenade" autoFocus />
        </label>
      </div>
      <label className="f">
        Projektadresse
        <input {...f('address')} placeholder="Promenade 11-13, 4020 Linz" />
      </label>
      <div className="grid2">
        <label className="f">
          Auftraggeber
          <input {...f('clientName')} />
        </label>
        <label className="f">
          Adresse Auftraggeber
          <input {...f('clientAddress')} />
        </label>
      </div>
    </Modal>
  );
}
