import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { api } from '../api';
import { save } from '../db';
import { useProjectData, useGlobal, useSettings, addFile, useFileUrl } from '../data';
import { Modal, LazyInput, StringListEditor, DateInput } from '../components/ui';
import { SyncBadge, useUser } from '../App';
import { ContactPicker } from './Contacts';
import { ProjectTabs } from '../components/ProjectTabs';
import {
  fmtDate,
  todayIso,
  contactName,
  nextProtocolSeq,
  protocolCode,
  previousProtocol,
  carryOverItemIds,
  projectLists,
  type Project,
  type Protocol,
  type UserInfo,
  isOpenStatus,
} from '../../../shared/src/index';

export function ProjectPage() {
  const { pid } = useParams();
  const d = useProjectData(pid);
  const [tab, setTab] = useState<'offen' | 'beteiligte' | 'daten'>('daten');
  if (!d.loaded) return null;
  if (!d.project) return <div className="empty">Projekt nicht gefunden (evtl. noch nicht synchronisiert).</div>;
  const p = d.project;
  return (
    <>
      <div className="card sec-card">
        <div className="sec-h" style={{ border: 'none', margin: 0, padding: 0 }}>
          <i className="fa-solid fa-sliders" /> 00 Projektdaten, Beteiligte &amp; offene Punkte
          {p.archived && <span className="badge">archiviert</span>}
        </div>
        <div className="muted small" style={{ marginTop: 4 }}>
          Stammdaten des Projekts, Projektbeteiligte (Beteiligtenliste der Protokolle) und alle offenen Punkte über alle Protokolle.
        </div>
      </div>
      <div className="tabs">
        {(
          [
            ['daten', 'fa-sliders', 'Stammdaten'],
            ['beteiligte', 'fa-users', `Beteiligte (${p.participants.length})`],
            ['offen', 'fa-list-check', 'Offene Punkte'],
          ] as const
        ).map(([k, ic, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            <i className={'fa-solid ' + ic} /> {l}
          </button>
        ))}
      </div>
      {tab === 'offen' && <OpenItems d={d} />}
      {tab === 'beteiligte' && <Participants project={p} />}
      {tab === 'daten' && <ProjectData project={p} />}
    </>
  );
}

type D = ReturnType<typeof useProjectData>;

function ProtocolList({ d }: { d: D }) {
  const settings = useSettings();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState('');
  const typeName = (k: string) => settings.protocolTypes.find((t) => t.key === k)?.name || k;
  const list = d.protocols.filter((p) => !filter || p.typeKey === filter);
  return (
    <>
      <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} style={{ maxWidth: 280 }}>
          <option value="">Alle Protokollarten</option>
          {settings.protocolTypes.map((t) => (
            <option key={t.key} value={t.key}>
              {t.name}
            </option>
          ))}
        </select>
        <div style={{ flex: 1 }} />
        <button className="btn primary" style={{ flex: '0 0 auto' }} onClick={() => setCreating(true)}>
          + Neues Protokoll
        </button>
      </div>
      {!list.length ? (
        <div className="empty">Noch keine Protokolle.</div>
      ) : (
        <div className="tablewrap">
          <table className="list">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Nr.</th>
                <th>Bezeichnung</th>
                <th>Art</th>
                <th style={{ width: 100 }}>Datum</th>
                <th style={{ width: 60 }} className="c">
                  Punkte
                </th>
                <th style={{ width: 120 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav(`/p/${p.projectId}/protokoll/${p.id}`)}>
                  <td>
                    <b>{p.code}</b>
                  </td>
                  <td>{p.title}</td>
                  <td className="muted">{typeName(p.typeKey)}</td>
                  <td>{fmtDate(p.date)}</td>
                  <td className="c">{p.itemIds.length}</td>
                  <td>
                    {p.status === 'abgeschlossen' ? <span className="badge green">abgeschlossen</span> : <span className="badge orange">Entwurf</span>}{' '}
                    {p.sentAt && <span className="badge blue">versendet</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creating && <NewProtocol d={d} onClose={() => setCreating(false)} onCreated={(id) => nav(`/p/${d.project!.id}/protokoll/${id}`)} />}
    </>
  );
}

export function NewProtocol({ d, onClose, onCreated, initialType }: { d: D; onClose: () => void; onCreated: (id: string) => void; initialType?: string }) {
  const settings = useSettings();
  const project = d.project!;
  const types = projectLists(project, settings).protocolTypes;
  const defaultsFor = (key: string) => {
    const tt = types.find((x) => x.key === key);
    const sq = nextProtocolSeq(project.id, key, d.protocols);
    const pv = previousProtocol({ projectId: project.id, typeKey: key, seq: sq }, d.protocols);
    return {
      title: pv?.title || (tt?.name ?? ''),
      timeFrom: pv?.nextMeeting?.timeFrom || pv?.timeFrom || '',
      timeTo: pv?.nextMeeting?.timeTo || pv?.timeTo || '',
      date: pv?.nextMeeting?.date && pv.nextMeeting.date >= todayIso() ? pv.nextMeeting.date : todayIso(),
      location: pv?.nextMeeting?.location || pv?.location || project.address,
    };
  };
  const firstKey = (initialType && types.some((x) => x.key === initialType) ? initialType : types[0]?.key) || '';
  const [typeKey, setTypeKeyRaw] = useState(firstKey);
  const [form, setForm] = useState(() => defaultsFor(firstKey));
  const setTypeKey = (k: string) => {
    setTypeKeyRaw(k);
    setForm(defaultsFor(k));
  };
  const t = types.find((x) => x.key === typeKey);
  const seq = nextProtocolSeq(project.id, typeKey, d.protocols);
  const prev = previousProtocol({ projectId: project.id, typeKey, seq }, d.protocols);
  const carry = carryOverItemIds(prev, d.itemMap);
  const [takeOver, setTakeOver] = useState(true);
  if (!t) return <Modal title="Neues Protokoll" onClose={onClose}>Keine Protokollarten aktiv – bitte in den Einstellungen anlegen.</Modal>;
  const code = protocolCode(t.prefix, seq);
  const create = async () => {
    const attendees = prev
      ? prev.attendees.map((a) => ({ ...a, present: false }))
      : project.participants.map((pp) => ({ contactId: pp.contactId, distribution: pp.defaultDistribution, present: false }));
    const id = await save<Protocol>(
      'protocol',
      null,
      {
        typeKey,
        mode: t.mode,
        seq,
        code,
        ...form,
        status: 'entwurf',
        attendees,
        groupBy: prev?.groupBy || 'category',
        itemIds: takeOver ? carry : [],
        nextMeeting: null,
        endText: null,
        snapshot: null,
      },
      project.id,
    );
    onCreated(id);
  };
  const f = (k: keyof typeof form) => ({ value: form[k], onChange: (e: any) => setForm({ ...form, [k]: e.target.value }) });
  return (
    <Modal
      title="Neues Protokoll"
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={create}>
            {code} anlegen
          </button>
        </>
      }
    >
      <div className="grid2">
        <label className="f">
          Protokollart
          <select value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
            {types.map((x) => (
              <option key={x.key} value={x.key}>
                {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Nummer
          <input value={`${code}  (${t.mode === 'fortlaufend' ? 'fortlaufend' : 'Standard'})`} disabled />
        </label>
      </div>
      <label className="f">
        Bezeichnung
        <input {...f('title')} />
      </label>
      <div className="grid3">
        <label className="f">
          Datum
          <DateInput value={form.date} onChange={(v) => setForm({ ...form, date: v || todayIso() })} />
        </label>
        <label className="f">
          von
          <input type="time" {...f('timeFrom')} />
        </label>
        <label className="f">
          bis
          <input type="time" {...f('timeTo')} />
        </label>
      </div>
      <label className="f">
        Ort
        <input {...f('location')} />
      </label>
      {prev && (
        <label className="check">
          <input type="checkbox" checked={takeOver} onChange={(e) => setTakeOver(e.target.checked)} />
          {carry.length} nicht erledigte Punkte aus {prev.code} übernehmen (Nummern bleiben erhalten)
        </label>
      )}
    </Modal>
  );
}

function OpenItems({ d }: { d: D }) {
  const { companyMap, contactMap } = useGlobal();
  const nav = useNavigate();
  const [company, setCompany] = useState('');
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const today = todayIso();
  const lastProtocolOf = (itemId: string) =>
    d.protocols.filter((p) => p.itemIds.includes(itemId)).sort((a, b) => b.date.localeCompare(a.date))[0];
  const list = d.items
    .filter((i) => isOpenStatus(i.status))
    .filter((i) => !company || i.companyId === company)
    .filter((i) => !onlyOverdue || (i.dueTo || i.dueFrom || '9999') < today)
    .sort((a, b) => (a.dueTo || a.dueFrom || '9999').localeCompare(b.dueTo || b.dueFrom || '9999'));
  const companies = [...new Set(d.items.filter((i) => isOpenStatus(i.status) && i.companyId).map((i) => i.companyId!))];
  return (
    <>
      <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
        <select value={company} onChange={(e) => setCompany(e.target.value)} style={{ maxWidth: 320 }}>
          <option value="">Alle Firmen</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {companyMap.get(c)?.name}
            </option>
          ))}
        </select>
        <label className="check" style={{ flex: '0 0 auto' }}>
          <input type="checkbox" checked={onlyOverdue} onChange={(e) => setOnlyOverdue(e.target.checked)} /> nur überfällige
        </label>
      </div>
      {!list.length ? (
        <div className="empty">Keine offenen Punkte.</div>
      ) : (
        <div className="tablewrap">
          <table className="list">
            <thead>
              <tr>
                <th>Nr.</th>
                <th>Punkt</th>
                <th>Firma</th>
                <th>Zuständig</th>
                <th>fällig</th>
                <th>zuletzt in</th>
              </tr>
            </thead>
            <tbody>
              {list.map((i) => {
                const lp = lastProtocolOf(i.id);
                const due = i.dueTo || i.dueFrom;
                return (
                  <tr key={i.id} className="click" onClick={() => lp && nav(`/p/${i.projectId}?art=${lp.typeKey}&p=${lp.id}&i=${i.id}`)}>
                    <td className="small">{i.code}</td>
                    <td>
                      {i.priority === 'hoch' && <span style={{ color: 'var(--red)' }}>● </span>}
                      {i.title}
                    </td>
                    <td className="small">{i.companyId ? companyMap.get(i.companyId)?.name : 'Projektteam'}</td>
                    <td className="small">{contactName(i.responsibleId ? contactMap.get(i.responsibleId) : null)}</td>
                    <td className="small" style={{ color: due && due < today ? 'var(--red)' : undefined, fontWeight: due && due < today ? 600 : undefined }}>
                      {fmtDate(due)}
                    </td>
                    <td className="small">{lp?.code}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function Participants({ project }: { project: Project }) {
  const { contactMap, companyMap } = useGlobal();
  const [adding, setAdding] = useState(false);
  const update = (participants: Project['participants']) => save<Project>('project', project.id, { participants });
  const rows = project.participants
    .map((pp) => ({ pp, c: contactMap.get(pp.contactId) }))
    .sort((a, b) => {
      const ca = (a.c?.companyId && companyMap.get(a.c.companyId)?.name) || '';
      const cb = (b.c?.companyId && companyMap.get(b.c.companyId)?.name) || '';
      return ca.localeCompare(cb, 'de') || (a.c?.lastName || '').localeCompare(b.c?.lastName || '', 'de');
    });
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="muted small" style={{ alignSelf: 'center' }}>
          Projektbeteiligte erscheinen in der Beteiligtenliste der Protokolle. „Verteiler“ = standardmäßig im Verteiler neuer Protokolle.
        </div>
        <button className="btn primary" style={{ flex: '0 0 auto' }} onClick={() => setAdding(true)}>
          + Beteiligte hinzufügen
        </button>
      </div>
      <div className="tablewrap">
        <table className="list">
          <thead>
            <tr>
              <th>Firma</th>
              <th>Name</th>
              <th>Gewerk / Funktion im Projekt</th>
              <th>E-Mail</th>
              <th className="c">Verteiler</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ pp, c }) => (
              <tr key={pp.contactId}>
                <td className="small">{(c?.companyId && companyMap.get(c.companyId)?.name) || ''}</td>
                <td>{contactName(c) || <i className="muted">unbekannt</i>}</td>
                <td>
                  <LazyInput value={pp.role} onSave={(v) => update(project.participants.map((x) => (x.contactId === pp.contactId ? { ...x, role: v } : x)))} />
                </td>
                <td className="small">{c?.email}</td>
                <td className="c">
                  <input
                    type="checkbox"
                    checked={pp.defaultDistribution}
                    onChange={(e) => update(project.participants.map((x) => (x.contactId === pp.contactId ? { ...x, defaultDistribution: e.target.checked } : x)))}
                  />
                </td>
                <td>
                  <button className="btn small ghost danger" onClick={() => confirm('Aus Projekt entfernen?') && update(project.participants.filter((x) => x.contactId !== pp.contactId))}>
                    Entfernen
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && (
        <ContactPicker
          exclude={project.participants.map((p) => p.contactId)}
          onClose={() => setAdding(false)}
          onPick={(ids) => {
            const add = ids.map((id) => ({ contactId: id, role: contactMap.get(id)?.function || '', defaultDistribution: true }));
            update([...project.participants, ...add]);
            setAdding(false);
          }}
        />
      )}
    </>
  );
}

function ProjectData({ project }: { project: Project }) {
  const user = useUser();
  const settings = useSettings();
  const [users, setUsers] = useState<UserInfo[]>([]);
  const img = useFileUrl(project.imageFileId);
  useEffect(() => {
    api<UserInfo[]>('/api/users').then(setUsers).catch(() => {});
  }, []);
  const set = (patch: Partial<Project>) => save<Project>('project', project.id, patch);
  const F = ({ k, label }: { k: 'number' | 'name' | 'address' | 'clientName' | 'clientAddress'; label: string }) => (
    <label className="f">
      {label}
      <LazyInput value={project[k]} onSave={(v) => set({ [k]: v })} />
    </label>
  );
  const ListOverride = ({ k, label }: { k: 'categories' | 'itemTypes' | 'trades'; label: string }) => (
    <div>
      <label className="check">
        <input type="checkbox" checked={project[k] == null} onChange={(e) => set({ [k]: e.target.checked ? null : [...settings[k]] })} /> {label}: Vorgabe aus Einstellungen
      </label>
      {project[k] != null && <StringListEditor value={project[k]!} onChange={(v) => set({ [k]: v })} />}
    </div>
  );
  return (
    <>
      <div className="card">
        <h3>
          <i className="fa-solid fa-file-signature" /> 1. Allgemeine Projekt-Stammdaten
        </h3>
        <div className="grid2">
          {F({ k: "number", label: "Projektnummer" })}
          {F({ k: "name", label: "Projektbezeichnung" })}
        </div>
        {F({ k: "address", label: "Projektadresse" })}
        <div className="grid2">
          {F({ k: "clientName", label: "Auftraggeber" })}
          {F({ k: "clientAddress", label: "Adresse Auftraggeber" })}
        </div>
        <div className="row" style={{ alignItems: 'center' }}>
          <div style={{ flex: '0 0 auto', minWidth: 160 }}>{img ? <img src={img} style={{ width: 160, borderRadius: 6 }} alt="" /> : <div className="muted small">Kein Projektbild</div>}</div>
          <label className="btn" style={{ flex: '0 0 auto' }}>
            Projektbild wählen
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) set({ imageFileId: await addFile(f, project.id) });
              }}
            />
          </label>
        </div>
      </div>
      <div className="card">
        <h3>
          <i className="fa-solid fa-user-lock" /> 2. Mitarbeiter mit Zugriff
        </h3>
        {users.length === 0 && <div className="muted small">Benutzerliste nur online verfügbar.</div>}
        {users
          .filter((u) => u.active)
          .map((u) => (
            <label key={u.id} className="check">
              <input
                type="checkbox"
                disabled={u.role === 'admin' || user.role !== 'admin'}
                checked={u.role === 'admin' || project.memberUserIds.includes(u.id)}
                onChange={(e) => set({ memberUserIds: e.target.checked ? [...project.memberUserIds, u.id] : project.memberUserIds.filter((x) => x !== u.id) })}
              />
              {u.name} {u.role === 'admin' && <span className="muted small">(Admin – immer)</span>}
            </label>
          ))}
      </div>
      <div className="card">
        <h3>
          <i className="fa-solid fa-list" /> 3. Projektspezifische Listen &amp; Protokollarten
        </h3>
        {ListOverride({ k: "categories", label: "Zusatzfeld" })}
        {ListOverride({ k: "itemTypes", label: "Typen" })}
        {ListOverride({ k: "trades", label: "Gewerke" })}
        <h3>Protokollarten in diesem Projekt</h3>
        {settings.protocolTypes.map((t) => (
          <label key={t.key} className="check">
            <input
              type="checkbox"
              checked={!project.protocolTypeKeys || project.protocolTypeKeys.includes(t.key)}
              onChange={(e) => {
                const cur = project.protocolTypeKeys || settings.protocolTypes.map((x) => x.key);
                set({ protocolTypeKeys: e.target.checked ? [...cur, t.key] : cur.filter((x) => x !== t.key) });
              }}
            />
            {t.name}
          </label>
        ))}
      </div>
      <button className="btn" onClick={() => set({ archived: !project.archived })}>
        {project.archived ? 'Projekt reaktivieren' : 'Projekt archivieren'}
      </button>
    </>
  );
}
