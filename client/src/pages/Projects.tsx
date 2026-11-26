import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '../data';
import { save } from '../db';
import { Modal } from '../components/ui';
import { useUser } from '../App';
import type { Project } from '../../../shared/src/index';

export function ProjectsPage() {
  const { projects, loaded } = useProjects();
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(() => {
    // Aufruf von der Startseite: /?neu=1 öffnet direkt „Neues Projekt“
    const neu = new URLSearchParams(window.location.search).has('neu');
    if (neu) window.history.replaceState(null, '', '/');
    return neu;
  });
  const nav = useNavigate();
  const list = projects.filter((p) => p.archived === showArchived && (!q || `${p.number} ${p.name} ${p.address}`.toLowerCase().includes(q.toLowerCase())));
  const user = useUser();
  return (
    <div className="start-bg">
      <div className="start-box">
        <div className="start-head">
          <div className="hdr-logo">
            <img src="/logo.png" alt="Skop Bauconsulting" />
          </div>
          <div>
            <div className="t">Projektmanagement</div>
            <div className="s">Protokolle, Pläne, Mängel, Kosten &amp; Baudokumentation</div>
          </div>
        </div>
        <div className="start-grid">
          <div className="st-card2">
            <div className="st-h2">
              <i className="fa-solid fa-bolt" /> Schnellzugriff
            </div>
            <div className="quick">
              <button onClick={() => setCreating(true)}>
                <i className="fa-solid fa-folder-plus" /> Neues Projekt anlegen
              </button>
              <button onClick={() => nav('/import')}>
                <i className="fa-solid fa-file-import" /> Import aus Baumaster
              </button>
              <button onClick={() => nav('/kontakte')}>
                <i className="fa-solid fa-address-book" /> Firmen &amp; Kontakte
              </button>
              <a href="/kosten/">
                <i className="fa-solid fa-coins" /> Kostenverfolgung (alle Projekte)
              </a>
              <button onClick={() => nav('/einstellungen')}>
                <i className="fa-solid fa-gear" /> Einstellungen &amp; Benutzer
              </button>
            </div>
          </div>
          <div className="st-card2">
            <div className="st-h2">
              <i className="fa-solid fa-folder-open" /> Projekt wählen
              <span className="who">
                angemeldet: <b>{user.name}</b>
              </span>
            </div>
            <div className="row" style={{ marginBottom: 10, alignItems: 'center' }}>
              <input placeholder="Projekt suchen (Nr., Name, Adresse, Auftraggeber) …" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
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
                      <th style={{ width: 80 }}>Nr.</th>
                      <th>Projekt</th>
                      <th>Auftraggeber</th>
                      <th style={{ width: 110 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id} className="click" onClick={() => nav('/p/' + p.id)}>
                        <td>
                          <b>{p.number}</b>
                        </td>
                        <td>
                          <b>{p.name}</b>
                          {p.address && <div className="muted small">{p.address}</div>}
                        </td>
                        <td className="small">{p.clientName}</td>
                        <td>
                          <button className="btn small primary">
                            <i className="fa-solid fa-arrow-right" /> Öffnen
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn primary" style={{ flex: '0 0 auto' }} onClick={() => setCreating(true)}>
                <i className="fa-solid fa-folder-plus" /> Neues Projekt
              </button>
            </div>
          </div>
        </div>
      </div>
      {creating && <NewProject onClose={() => setCreating(false)} onCreated={(id) => nav('/p/' + id)} />}
    </div>
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
