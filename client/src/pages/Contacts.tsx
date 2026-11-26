import { useState } from 'react';
import { useGlobal } from '../data';
import { save, remove } from '../db';
import { Modal } from '../components/ui';
import { SyncBadge } from '../App';
import { contactName, type Company, type Contact } from '../../../shared/src/index';

export function ContactsPage() {
  const { companies, contacts } = useGlobal();
  const [q, setQ] = useState('');
  const [editCompany, setEditCompany] = useState<Partial<Company> | null>(null);
  const [editContact, setEditContact] = useState<Partial<Contact> | null>(null);
  const ql = q.toLowerCase();
  const byCompany = (cid: string | null) => contacts.filter((c) => (c.companyId || null) === cid);
  const match = (c: Contact) => !q || `${contactName(c)} ${c.email} ${c.function}`.toLowerCase().includes(ql);
  const groups = [...companies.map((co) => ({ co, list: byCompany(co.id) })), { co: null as Company | null, list: byCompany(null) }].filter(
    (g) => !q || (g.co && g.co.name.toLowerCase().includes(ql)) || g.list.some(match),
  );
  return (
    <>
      <div className="topbar">
        <h1>Firmen & Kontakte</h1>
        <div className="grow" />
        <SyncBadge />
        <button className="btn" onClick={() => setEditCompany({})}>
          + Firma
        </button>
        <button className="btn primary" onClick={() => setEditContact({})}>
          + Kontakt
        </button>
      </div>
      <input placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360, marginBottom: 12 }} />
      {groups.map(({ co, list }) =>
        co || list.length ? (
          <div className="card" key={co?.id || 'none'}>
            <div className="row" style={{ alignItems: 'center' }}>
              <div>
                <b>{co ? co.name : 'Ohne Firma'}</b>
                {co && <div className="muted small">{[co.address, co.uid && 'UID ' + co.uid, co.phone, co.email].filter(Boolean).join(' · ')}</div>}
              </div>
              {co && (
                <div style={{ flex: '0 0 auto', display: 'flex', gap: 6 }}>
                  <button className="btn small" onClick={() => setEditContact({ companyId: co.id })}>
                    + Kontakt
                  </button>
                  <button className="btn small" onClick={() => setEditCompany(co)}>
                    Bearbeiten
                  </button>
                </div>
              )}
            </div>
            {!!list.length && (
              <table className="list" style={{ marginTop: 8 }}>
                <tbody>
                  {list.filter((c) => match(c) || (co && co.name.toLowerCase().includes(ql))).map((c) => (
                    <tr key={c.id} className="click" onClick={() => setEditContact(c)}>
                      <td style={{ width: '28%' }}>
                        {c.title ? c.title + ' ' : ''}
                        {contactName(c)}
                      </td>
                      <td className="small muted">{c.function}</td>
                      <td className="small">{c.phone}</td>
                      <td className="small">{c.email}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        ) : null,
      )}
      {editCompany && <CompanyForm value={editCompany} onClose={() => setEditCompany(null)} />}
      {editContact && <ContactForm value={editContact} onClose={() => setEditContact(null)} />}
    </>
  );
}

export function CompanyForm({ value, onClose, onSaved }: { value: Partial<Company>; onClose: () => void; onSaved?: (id: string) => void }) {
  const [c, setC] = useState({ name: '', address: '', phone: '', email: '', uid: '', ...value });
  const f = (k: 'name' | 'address' | 'phone' | 'email' | 'uid') => ({ value: c[k] || '', onChange: (e: any) => setC({ ...c, [k]: e.target.value }) });
  return (
    <Modal
      title={value.id ? 'Firma bearbeiten' : 'Neue Firma'}
      onClose={onClose}
      actions={
        <>
          {value.id && (
            <button className="btn danger" onClick={() => confirm('Firma löschen? Kontakte bleiben erhalten.') && remove('company', value.id!).then(onClose)}>
              Löschen
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn primary"
            disabled={!c.name}
            onClick={async () => {
              const id = await save<Company>('company', value.id || null, { name: c.name, address: c.address, phone: c.phone, email: c.email, uid: c.uid });
              onSaved?.(id);
              onClose();
            }}
          >
            Speichern
          </button>
        </>
      }
    >
      <label className="f">
        Firmenname *
        <input {...f('name')} autoFocus />
      </label>
      <div className="grid2">
        <label className="f">
          Adresse
          <input {...f('address')} />
        </label>
        <label className="f">
          UID-Nr.
          <input {...f('uid')} placeholder="ATU…" />
        </label>
      </div>
      <div className="grid2">
        <label className="f">
          Telefon
          <input {...f('phone')} />
        </label>
        <label className="f">
          E-Mail
          <input {...f('email')} />
        </label>
      </div>
    </Modal>
  );
}

export function ContactForm({ value, onClose, onSaved }: { value: Partial<Contact>; onClose: () => void; onSaved?: (id: string) => void }) {
  const { companies } = useGlobal();
  const [c, setC] = useState<Partial<Contact>>({ firstName: '', lastName: '', title: '', function: '', phone: '', email: '', companyId: null, ...value });
  const [newCompany, setNewCompany] = useState('');
  const f = (k: 'firstName' | 'lastName' | 'title' | 'function' | 'phone' | 'email') => ({ value: (c[k] as string) || '', onChange: (e: any) => setC({ ...c, [k]: e.target.value }) });
  return (
    <Modal
      title={value.id ? 'Kontakt bearbeiten' : 'Neuer Kontakt'}
      onClose={onClose}
      actions={
        <>
          {value.id && (
            <button className="btn danger" onClick={() => confirm('Kontakt löschen?') && remove('contact', value.id!).then(onClose)}>
              Löschen
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn primary"
            disabled={!c.lastName && !c.firstName}
            onClick={async () => {
              let companyId = c.companyId || null;
              if (companyId === '__new' && newCompany.trim()) {
                // gleichnamige Firma wiederverwenden statt doppelt anzulegen
                const existing = companies.find((co) => co.name.trim().toLowerCase() === newCompany.trim().toLowerCase());
                companyId = existing ? existing.id : await save<Company>('company', null, { name: newCompany.trim() });
              }
              if (companyId === '__new') companyId = null;
              const { id: _i, type: _t, rev: _r, ...rest } = c as any;
              const id = await save<Contact>('contact', value.id || null, { ...rest, companyId });
              onSaved?.(id);
              onClose();
            }}
          >
            Speichern
          </button>
        </>
      }
    >
      <label className="f">
        Firma
        <select value={c.companyId || ''} onChange={(e) => setC({ ...c, companyId: e.target.value || null })}>
          <option value="">– ohne Firma –</option>
          <option value="__new">+ neue Firma…</option>
          {companies.map((co) => (
            <option key={co.id} value={co.id}>
              {co.name}
            </option>
          ))}
        </select>
      </label>
      {c.companyId === '__new' && (
        <label className="f">
          Name der neuen Firma
          <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} />
        </label>
      )}
      <div className="grid3">
        <label className="f">
          Titel
          <input {...f('title')} placeholder="Bmstr. / DI …" />
        </label>
        <label className="f">
          Vorname
          <input {...f('firstName')} />
        </label>
        <label className="f">
          Nachname
          <input {...f('lastName')} />
        </label>
      </div>
      <label className="f">
        Funktion / Gewerk (Vorgabe)
        <input {...f('function')} />
      </label>
      <div className="grid2">
        <label className="f">
          Telefon
          <input {...f('phone')} />
        </label>
        <label className="f">
          E-Mail
          <input type="email" {...f('email')} />
        </label>
      </div>
    </Modal>
  );
}

/** Mehrfachauswahl von Kontakten inkl. Neuanlage */
export function ContactPicker({ exclude = [], onPick, onClose }: { exclude?: string[]; onPick: (ids: string[]) => void; onClose: () => void }) {
  const { contacts, companyMap } = useGlobal();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const ql = q.toLowerCase();
  const list = contacts
    .filter((c) => !exclude.includes(c.id))
    .filter((c) => !q || `${contactName(c)} ${c.companyId ? companyMap.get(c.companyId)?.name : ''} ${c.function}`.toLowerCase().includes(ql))
    .sort((a, b) => ((a.companyId && companyMap.get(a.companyId)?.name) || '').localeCompare((b.companyId && companyMap.get(b.companyId)?.name) || '', 'de'));
  return (
    <Modal
      title="Beteiligte hinzufügen"
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={() => setCreating(true)}>
            + Neuer Kontakt
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!sel.length} onClick={() => onPick(sel)}>
            {sel.length} hinzufügen
          </button>
        </>
      }
    >
      <input placeholder="Name, Firma oder Gewerk suchen…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div style={{ maxHeight: '50vh', overflowY: 'auto', marginTop: 8 }}>
        <table className="list">
          <tbody>
            {list.map((c) => (
              <tr key={c.id} className="click" onClick={() => setSel(sel.includes(c.id) ? sel.filter((x) => x !== c.id) : [...sel, c.id])}>
                <td style={{ width: 30 }}>
                  <input type="checkbox" readOnly checked={sel.includes(c.id)} />
                </td>
                <td>{contactName(c)}</td>
                <td className="small">{c.companyId && companyMap.get(c.companyId)?.name}</td>
                <td className="small muted">{c.function}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="empty">Keine Kontakte gefunden.</div>}
      </div>
      {creating && <ContactForm value={{}} onClose={() => setCreating(false)} onSaved={(id) => setSel((s) => [...s, id])} />}
    </Modal>
  );
}
