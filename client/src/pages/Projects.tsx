import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '../data';
import { save } from '../db';
import { Modal } from '../components/ui';
import { SyncBadge, useUser } from '../App';
import type { Project } from '../../../shared/src/index';

export function ProjectsPage() {
  const { projects, loaded } = useProjects();
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const nav = useNavigate();
  const list = projects.filter((p) => p.archived === showArchived && (!q || `${p.number} ${p.name} ${p.address}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <div className="topbar">
        <h1>Projekte</h1>
        <div className="grow" />
        <SyncBadge />
        <button className="btn primary" onClick={() => setCreating(true)}>
          + Neues Projekt
        </button>
      </div>
      <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
        <input placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
        <label className="check" style={{ flex: '0 0 auto' }}>
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Archivierte
        </label>
      </div>
      {loaded && !list.length && <div className="empty">{projects.length ? 'Keine Treffer.' : 'Noch keine Projekte. Legen Sie Ihr erstes Projekt an.'}</div>}
      {!!list.length && (
        <div className="tablewrap">
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Nr.</th>
                <th>Projekt</th>
                <th>Adresse</th>
                <th>Auftraggeber</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav('/p/' + p.id)}>
                  <td>{p.number}</td>
                  <td>
                    <b>{p.name}</b>
                  </td>
                  <td className="muted">{p.address}</td>
                  <td className="muted">{p.clientName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewProject onClose={() => setCreating(false)} onCreated={(id) => nav('/p/' + id)} />}
    </>
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
