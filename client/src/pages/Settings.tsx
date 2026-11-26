import { useEffect, useState } from 'react';
import { api } from '../api';
import { save, ldb } from '../db';
import { useSettings, addFile, useFileUrl } from '../data';
import { LazyInput, LazyTextarea, StringListEditor, Modal } from '../components/ui';
import { SyncBadge, useUser } from '../App';
import type { Settings, PdfLayout, ProtocolTypeDef, UserInfo } from '../../../shared/src/index';

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const user = useUser();
  const isAdmin = user.role === 'admin';
  const [tab, setTab] = useState(isAdmin ? 'firma' : 'konto');
  const tabs = [
    ...(isAdmin
      ? [
          ['firma', 'Firma & Texte'],
          ['arten', 'Protokollarten'],
          ['listen', 'Listen'],
          ['pdf', 'PDF-Layout'],
          ['mail', 'E-Mail-Versand'],
          ['benutzer', 'Benutzer'],
        ]
      : []),
    ['konto', 'Mein Konto'],
  ];
  return (
    <>
      <div className="topbar">
        <h1>Einstellungen</h1>
        <div className="grow" />
      </div>
      <div className="tabs">
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'firma' && <CompanyTab />}
      {tab === 'arten' && <TypesTab />}
      {tab === 'listen' && <ListsTab />}
      {tab === 'pdf' && <PdfTab />}
      {tab === 'mail' && <MailTab />}
      {tab === 'benutzer' && <UsersTab />}
      {tab === 'konto' && <AccountTab onLogout={onLogout} />}
    </>
  );
}

const setS = (patch: Partial<Settings>) => save<Settings>('settings', 'settings', patch);

function CompanyTab() {
  const s = useSettings();
  const logo = useFileUrl(s.logoFileId);
  return (
    <div className="card">
      <div className="grid2">
        <label className="f">
          Firmenname
          <LazyInput value={s.companyName} onSave={(v) => setS({ companyName: v })} />
        </label>
        <label className="f">
          Adresse (Kopfzeile)
          <LazyInput value={s.companyAddress} onSave={(v) => setS({ companyAddress: v })} />
        </label>
        <label className="f">
          E-Mail
          <LazyInput value={s.companyEmail} onSave={(v) => setS({ companyEmail: v })} />
        </label>
        <label className="f">
          Telefon
          <LazyInput value={s.companyPhone} onSave={(v) => setS({ companyPhone: v })} />
        </label>
      </div>
      <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
        <img src={logo || '/logo.png'} style={{ maxWidth: 240, flex: '0 0 auto' }} alt="Logo" />
        <label className="btn" style={{ flex: '0 0 auto' }}>
          Anderes Logo wählen
          <input type="file" accept="image/png,image/jpeg" hidden onChange={async (e) => e.target.files?.[0] && setS({ logoFileId: await addFile(e.target.files[0], null) })} />
        </label>
        {s.logoFileId && (
          <button className="btn" style={{ flex: '0 0 auto' }} onClick={() => setS({ logoFileId: null })}>
            Standardlogo
          </button>
        )}
      </div>
      <label className="f">
        Endtext (Vorgabe für alle Protokolle)
        <LazyTextarea value={s.endText} rows={4} onSave={(v) => setS({ endText: v })} />
      </label>
      <label className="f" style={{ maxWidth: 320 }}>
        Bezeichnung der datierten Einträge im PDF
        <select value={s.entryLabel} onChange={(e) => setS({ entryLabel: e.target.value })}>
          <option value="Anm.">Anm. 26.11.2026:</option>
          <option value="Eintrag">Eintrag 26.11.2026:</option>
          <option value="Stand">Stand 26.11.2026:</option>
        </select>
      </label>
      <label className="f">
        Unterschriftszeile
        <LazyInput value={s.signature} onSave={(v) => setS({ signature: v })} />
      </label>
      <h3>E-Mail-Vorlage</h3>
      <div className="muted small">Platzhalter: {'{projekt} {protokoll} {datum} {bezeichnung} {firma}'}</div>
      <label className="f">
        Betreff
        <LazyInput value={s.mailSubjectTemplate} onSave={(v) => setS({ mailSubjectTemplate: v })} />
      </label>
      <label className="f">
        Text
        <LazyTextarea rows={7} value={s.mailBodyTemplate} onSave={(v) => setS({ mailBodyTemplate: v })} />
      </label>
    </div>
  );
}

function TypesTab() {
  const s = useSettings();
  const upd = (i: number, patch: Partial<ProtocolTypeDef>) => setS({ protocolTypes: s.protocolTypes.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <div className="card">
      <div className="tablewrap">
        <table className="list">
          <thead>
            <tr>
              <th>Bezeichnung</th>
              <th style={{ width: 110 }}>Präfix</th>
              <th style={{ width: 170 }}>Art</th>
              <th className="c" style={{ width: 70 }}>
                Mängel
              </th>
              <th className="c" style={{ width: 70 }}>
                aktiv
              </th>
            </tr>
          </thead>
          <tbody>
            {s.protocolTypes.map((t, i) => (
              <tr key={t.key}>
                <td>
                  <LazyInput value={t.name} onSave={(v) => upd(i, { name: v })} />
                </td>
                <td>
                  <LazyInput value={t.prefix} onSave={(v) => upd(i, { prefix: v.toUpperCase().replace(/\s/g, '') })} />
                </td>
                <td>
                  <select value={t.mode} onChange={(e) => upd(i, { mode: e.target.value as any })}>
                    <option value="fortlaufend">fortlaufend (gesperrt)</option>
                    <option value="standard">Standard (frei)</option>
                  </select>
                </td>
                <td className="c" title="Neue Punkte dieser Protokollart sind Mängel">
                  <input type="checkbox" checked={!!t.defects} onChange={(e) => upd(i, { defects: e.target.checked })} />
                </td>
                <td className="c">
                  <input type="checkbox" checked={t.active} onChange={(e) => upd(i, { active: e.target.checked })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="btn"
        style={{ marginTop: 10 }}
        onClick={() => {
          const name = prompt('Bezeichnung der neuen Protokollart');
          if (!name) return;
          const prefix = (prompt('Präfix für die Nummer (z.B. BBP)') || name.slice(0, 3)).toUpperCase();
          setS({ protocolTypes: [...s.protocolTypes, { key: prefix + '_' + Date.now().toString(36), name, prefix, mode: 'fortlaufend', active: true }] });
        }}
      >
        + Protokollart
      </button>
      <p className="muted small">Hinweis: Eine Änderung des Präfixes wirkt nur auf neue Protokolle; bestehende Nummern bleiben unverändert.</p>
    </div>
  );
}

function ListsTab() {
  const s = useSettings();
  return (
    <div className="grid3">
      <div className="card">
        <h3>Zusatzfeld (Gliederung)</h3>
        <StringListEditor value={s.categories} onChange={(v) => setS({ categories: v })} />
      </div>
      <div className="card">
        <h3>Typen</h3>
        <StringListEditor value={s.itemTypes} onChange={(v) => setS({ itemTypes: v })} />
      </div>
      <div className="card">
        <h3>Gewerke</h3>
        <StringListEditor value={s.trades} onChange={(v) => setS({ trades: v })} />
      </div>
      <div className="card">
        <h3>Mangelarten</h3>
        <StringListEditor value={s.defectTypes} onChange={(v) => setS({ defectTypes: v })} />
      </div>
      <p className="muted small">Ein Eintrag pro Zeile. Die Reihenfolge entspricht der Sortierung im Protokoll. Projekte können eigene Listen verwenden (Projektdaten).</p>
    </div>
  );
}

function PdfTab() {
  const s = useSettings();
  const L = s.pdf;
  const set = (patch: Partial<PdfLayout>) => setS({ pdf: { ...L, ...patch } });
  const C = ({ k, label }: { k: keyof PdfLayout; label: string }) => (
    <label className="check" style={{ display: 'flex' }}>
      <input type="checkbox" checked={!!L[k]} onChange={(e) => set({ [k]: e.target.checked } as any)} /> {label}
    </label>
  );
  const F = ({ k, label }: { k: keyof PdfLayout['fields']; label: string }) => (
    <label className="check" style={{ display: 'flex' }}>
      <input type="checkbox" checked={L.fields[k]} onChange={(e) => set({ fields: { ...L.fields, [k]: e.target.checked } })} /> {label}
    </label>
  );
  return (
    <>
      <div className="card">
        <h3>Allgemein</h3>
        <div className="grid2">
          {C({ k: 'showCompanyHeader', label: 'Eigene Firmendaten anführen' })}
          {C({ k: 'showProjectNumber', label: 'Projektnummer andrucken' })}
          {C({ k: 'showProtocolNumber', label: 'Protokollnummer andrucken' })}
          {C({ k: 'showProjectAddress', label: 'Projektadresse andrucken' })}
        </div>
        <h3>Kontakte</h3>
        <div className="grid2">
          {C({ k: 'showAttendees', label: 'Beteiligtenliste andrucken' })}
          {C({ k: 'allProjectContacts', label: 'Alle Kontakte des Projekts einfügen' })}
        </div>
        <h3>Einträge</h3>
        <div className="grid2">
          {C({ k: 'entriesOnSecondPage', label: 'Einträge auf 2. Seite beginnen' })}
          {C({ k: 'keepEntryTogether', label: 'Eintrag am Seitenende nicht teilen' })}
          {C({ k: 'newPagePerEntry', label: 'Neue Seite je Eintrag' })}
        </div>
        <label className="f" style={{ maxWidth: 260, marginTop: 8 }}>
          Bilder
          <select value={L.imageSize} onChange={(e) => set({ imageSize: e.target.value as any })}>
            <option value="none">Keine</option>
            <option value="small">Klein</option>
            <option value="medium">Mittel</option>
            <option value="large">Groß</option>
          </select>
        </label>
      </div>
      <div className="card">
        <h3>Eintrags-Details</h3>
        <div className="grid3">
          {F({ k: 'company', label: 'Firma' })}
          {F({ k: 'responsible', label: 'Zuständig' })}
          {F({ k: 'observer', label: 'Beobachter' })}
          {F({ k: 'itemType', label: 'Typ' })}
          {F({ k: 'trade', label: 'Gewerk' })}
          {F({ k: 'category', label: 'Zusatzfeld' })}
          {F({ k: 'location', label: 'Lage' })}
          {F({ k: 'priority', label: 'Priorität' })}
          {F({ k: 'due', label: 'Zu erledigen von / bis' })}
          {F({ k: 'planMarkers', label: 'Planmarker (Planausschnitt)' })}
        </div>
      </div>
    </>
  );
}

function MailTab() {
  const [s, setSmtp] = useState<any>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    api('/api/admin/smtp').then(setSmtp).catch((e) => setMsg(e.message || 'Nur online verfügbar'));
  }, []);
  if (!s) return <div className="card">{msg || 'Lade…'}</div>;
  const f = (k: string) => ({ value: s[k] ?? '', onChange: (e: any) => setSmtp({ ...s, [k]: e.target.value }) });
  return (
    <div className="card">
      <p className="muted small">
        Zugangsdaten Ihres Postfachs bei Internex (office@skop-bauconsulting.at). Diese werden nur auf Ihrem Server gespeichert und nie auf die Geräte übertragen.
      </p>
      {msg && <div className="notice">{msg}</div>}
      <div className="grid3">
        <label className="f">
          SMTP-Server
          <input {...f('host')} placeholder="mti62028113.secure-node.com" />
        </label>
        <label className="f">
          Port
          <input {...f('port')} />
        </label>
        <label className="f">
          Verschlüsselung
          <select value={s.secure ? '1' : '0'} onChange={(e) => setSmtp({ ...s, secure: e.target.value === '1', port: e.target.value === '1' ? 465 : 587 })}>
            <option value="1">SSL/TLS (Port 465)</option>
            <option value="0">STARTTLS (Port 587)</option>
          </select>
        </label>
        <label className="f">
          Benutzername
          <input {...f('user')} />
        </label>
        <label className="f">
          Passwort
          <input type="password" {...f('password')} />
        </label>
        <label className="f">
          Absender
          <input {...f('from')} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={!!s.bccSelf} onChange={(e) => setSmtp({ ...s, bccSelf: e.target.checked })} /> Kopie jeder Sendung an das Büro-Postfach
      </label>
      <div className="row" style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          style={{ flex: '0 0 auto' }}
          onClick={async () => {
            await api('/api/admin/smtp', { method: 'PUT', body: s });
            setMsg('Gespeichert.');
          }}
        >
          Speichern
        </button>
        <button
          className="btn"
          style={{ flex: '0 0 auto' }}
          onClick={async () => {
            setMsg('Sende Testnachricht…');
            try {
              await api('/api/admin/smtp', { method: 'PUT', body: s });
              await api('/api/admin/smtp/test', { method: 'POST', body: {} });
              setMsg('Testnachricht an Ihre Benutzer-E-Mail gesendet.');
            } catch (e: any) {
              setMsg('Fehler: ' + e.message);
            }
          }}
        >
          Test senden
        </button>
      </div>
    </div>
  );
}

function UsersTab() {
  const me = useUser();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const load = () => api<UserInfo[]>('/api/users').then(setUsers).catch((e) => setErr(e.message));
  useEffect(() => {
    load();
  }, []);
  const patch = async (id: string, body: any) => {
    try {
      await api('/api/users/' + id, { method: 'PATCH', body });
      load();
    } catch (e: any) {
      alert(e.message);
    }
  };
  return (
    <div className="card">
      {err && <div className="notice">{err}</div>}
      <table className="list">
        <thead>
          <tr>
            <th>Name</th>
            <th>E-Mail</th>
            <th>Rolle</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td>{u.email}</td>
              <td>
                <select value={u.role} disabled={u.id === me.id} onChange={(e) => patch(u.id, { role: e.target.value })}>
                  <option value="admin">Administrator</option>
                  <option value="mitarbeiter">Mitarbeiter</option>
                </select>
              </td>
              <td>{u.active ? <span className="badge green">aktiv</span> : <span className="badge">deaktiviert</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn small" onClick={() => { const p = prompt('Neues Passwort (min. 8 Zeichen)'); if (p) patch(u.id, { password: p }); }}>
                  Passwort
                </button>{' '}
                {u.id !== me.id && (
                  <button className="btn small" onClick={() => patch(u.id, { active: !u.active })}>
                    {u.active ? 'Deaktivieren' : 'Aktivieren'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button className="btn primary" style={{ marginTop: 10 }} onClick={() => setAdding(true)}>
        + Benutzer
      </button>
      <p className="muted small">Mitarbeiter sehen nur Projekte, für die sie im Projekt (Projektdaten → Mitarbeiter mit Zugriff) freigeschaltet sind. Administratoren sehen alle Projekte.</p>
      {adding && <NewUser onClose={() => setAdding(false)} onDone={load} />}
    </div>
  );
}

function NewUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [u, setU] = useState({ name: '', email: '', password: '', role: 'mitarbeiter' });
  const [err, setErr] = useState('');
  return (
    <Modal
      title="Neuer Benutzer"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await api('/api/users', { body: u });
                onDone();
                onClose();
              } catch (e: any) {
                setErr(e.message);
              }
            }}
          >
            Anlegen
          </button>
        </>
      }
    >
      {err && <div className="notice red">{err}</div>}
      <label className="f">
        Name
        <input value={u.name} onChange={(e) => setU({ ...u, name: e.target.value })} />
      </label>
      <label className="f">
        E-Mail (Anmeldename)
        <input type="email" value={u.email} onChange={(e) => setU({ ...u, email: e.target.value })} />
      </label>
      <label className="f">
        Erstes Passwort (min. 8 Zeichen)
        <input value={u.password} onChange={(e) => setU({ ...u, password: e.target.value })} />
      </label>
      <label className="f">
        Rolle
        <select value={u.role} onChange={(e) => setU({ ...u, role: e.target.value })}>
          <option value="mitarbeiter">Mitarbeiter</option>
          <option value="admin">Administrator</option>
        </select>
      </label>
    </Modal>
  );
}

function AccountTab({ onLogout }: { onLogout: () => void }) {
  const user = useUser();
  const [pw, setPw] = useState({ oldPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  return (
    <div className="card">
      <p>
        Angemeldet als <b>{user.name}</b> ({user.email}, {user.role === 'admin' ? 'Administrator' : 'Mitarbeiter'})
      </p>
      <h3>Passwort ändern</h3>
      {msg && <div className="notice">{msg}</div>}
      <div className="grid2">
        <label className="f">
          Aktuelles Passwort
          <input type="password" value={pw.oldPassword} onChange={(e) => setPw({ ...pw, oldPassword: e.target.value })} />
        </label>
        <label className="f">
          Neues Passwort
          <input type="password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
        </label>
      </div>
      <button
        className="btn"
        onClick={async () => {
          try {
            await api('/api/me/password', { body: pw });
            setMsg('Passwort geändert.');
            setPw({ oldPassword: '', newPassword: '' });
          } catch (e: any) {
            setMsg(e.message);
          }
        }}
      >
        Ändern
      </button>
      <h3>Gerät</h3>
      <div className="row">
        <button
          className="btn"
          style={{ flex: '0 0 auto' }}
          onClick={async () => {
            const n = await ldb.outbox.count();
            if (n && !confirm(`${n} Änderungen sind noch nicht synchronisiert und gehen verloren. Trotzdem abmelden?`)) return;
            onLogout();
          }}
        >
          Abmelden
        </button>
        <button
          className="btn"
          style={{ flex: '0 0 auto' }}
          onClick={async () => {
            const n = await ldb.outbox.count();
            if (n) return alert('Bitte zuerst synchronisieren – es sind noch Änderungen ausstehend.');
            if (!confirm('Lokale Daten dieses Geräts löschen und neu vom Server laden?')) return;
            await ldb.delete();
            location.reload();
          }}
        >
          Lokale Daten neu laden
        </button>
      </div>
    </div>
  );
}
