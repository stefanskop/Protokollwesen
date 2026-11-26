// Planverwaltung je Projekt
import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { save, remove } from '../db';
import { api } from '../api';
import { getBlob, syncNow } from '../sync';
import { useProjectData, useProjects, useGlobal, useSettings, addFile, blobToDataUrl } from '../data';
import { Modal, DateInput } from '../components/ui';
import { PlanViewer, type ViewerMarker } from '../components/PlanViewer';
import { ProjectTabs } from '../components/ProjectTabs';
import { rememberProject, SyncBadge } from '../App';
import { fmtDate, todayIso, contactName, type Plan, type Project, type PlanVersion } from '../../../shared/src/index';

type D = ReturnType<typeof useProjectData>;

const nextIndex = (i: string) => {
  if (!i) return 'a';
  if (/^\d+$/.test(i)) return String(parseInt(i, 10) + 1);
  if (/^[a-y]$/i.test(i)) return String.fromCharCode(i.charCodeAt(0) + 1);
  return i + '1';
};

export function PlansPage() {
  const { pid } = useParams();
  const nav = useNavigate();
  const d = useProjectData(pid);
  const { projects } = useProjects();
  useEffect(() => {
    if (pid) rememberProject(pid);
  }, [pid]);
  const [folder, setFolder] = useState<string | null>(null); // null = alle
  const [q, setQ] = useState('');
  const [onlyActive, setOnlyActive] = useState(true);
  const [sel, setSel] = useState<string[]>([]);
  const [edit, setEdit] = useState<Plan | null>(null);
  const [view, setView] = useState<{ plan: Plan; version?: PlanVersion } | null>(null);
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState('');

  if (!d.loaded) return null;
  if (!d.project) return <div className="empty">Projekt nicht gefunden.</div>;
  const project = d.project;
  const folders = project.planFolders || [];
  const ql = q.toLowerCase();
  const list = d.plans
    .filter((p) => folder === null || p.folder === folder)
    .filter((p) => !onlyActive || p.active)
    .filter((p) => !q || `${p.name} ${p.keywords} ${p.location} ${p.index}`.toLowerCase().includes(ql));
  const groups = [...new Set(list.map((p) => p.folder))].sort((a, b) => (folders.indexOf(a) === -1 ? 999 : folders.indexOf(a)) - (folders.indexOf(b) === -1 ? 999 : folders.indexOf(b)));
  const markerCount = (planId: string) => d.items.reduce((n, i) => n + (i.planMarkers || []).filter((m) => m.planId === planId).length, 0);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const [k, f] of Array.from(files).entries()) {
      setBusy(`Lade ${k + 1}/${files.length}: ${f.name}`);
      const fileId = await addFile(f, project.id, f.name, { keepOriginal: true });
      await save<Plan>(
        'plan',
        null,
        {
          folder: folder || '',
          name: f.name.replace(/\.[^.]+$/, ''),
          index: '',
          scale: '',
          planDate: todayIso(),
          keywords: '',
          location: '',
          active: true,
          fileId,
          mime: f.type || 'application/pdf',
          versions: [],
        },
        project.id,
      );
    }
    setBusy('');
  };
  const newIndex = async (p: Plan, file: File) => {
    const idx = prompt('Neuer Index', nextIndex(p.index));
    if (idx === null) return;
    setBusy('Lade neuen Index…');
    const fileId = await addFile(file, project.id, file.name, { keepOriginal: true });
    const old: PlanVersion = { index: p.index, fileId: p.fileId, mime: p.mime, planDate: p.planDate, uploadedAt: p.updatedAt || p.createdAt || new Date().toISOString() };
    await save<Plan>('plan', p.id, { index: idx, fileId, mime: file.type || 'application/pdf', planDate: todayIso(), versions: [old, ...p.versions] });
    setBusy('');
  };
  const addFolder = () => {
    const n = prompt('Name des neuen Ordners (z.B. Ausführungspläne)');
    if (n && !folders.includes(n)) save<Project>('project', project.id, { planFolders: [...folders, n] });
  };
  const download = async (p: Plan, v?: PlanVersion) => {
    const b = await getBlob(v?.fileId || p.fileId);
    if (!b) return alert('Datei nicht verfügbar.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    const ext = (v?.mime || p.mime) === 'application/pdf' ? '.pdf' : '.' + ((v?.mime || p.mime).split('/')[1] || 'bin');
    a.download = `${p.name}${(v?.index ?? p.index) ? '_Index_' + (v?.index ?? p.index) : ''}${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
  const markersFor = (p: Plan): ViewerMarker[] =>
    d.items.flatMap((i) => (i.planMarkers || []).filter((m) => m.planId === p.id).map((m) => ({ marker: m, label: i.code, title: `${i.code} ${i.title}`, itemId: i.id })));
  const openItem = (itemId: string) => {
    const proto = d.protocols.filter((p) => p.itemIds.includes(itemId)).sort((a, b) => b.date.localeCompare(a.date))[0];
    if (proto) nav(`/p/${project.id}?art=${proto.typeKey}&p=${proto.id}&i=${itemId}`);
  };

  return (
    <div className="ws-wrap">
      <div className="ws-top">
        <span className="ws-title"><i className="fa-solid fa-map" /> Pläne</span>
        <input placeholder="Pläne suchen…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
        <label className="toggle">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} /> nur aktive
        </label>
        <div className="grow" />
        {busy && <span className="badge orange">{busy}</span>}
        <button className="btn" disabled={!sel.length} onClick={() => setSending(true)}>
          ✉ Senden ({sel.length})
        </button>
        <label className="btn primary">
          + Plan
          <input type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => (upload(e.target.files), (e.target.value = ''))} />
        </label>
      </div>
      <div className="plans">
        <div className="ws-col">
          <div className="col-h">Ordnerstruktur</div>
          <div className="col-body">
            <button className={'type-row' + (folder === null ? ' on' : '')} onClick={() => setFolder(null)}>
              <span className="tname">📂 Alle Pläne</span>
              <span className="cnt">{d.plans.length}</span>
            </button>
            {[...folders, ...(d.plans.some((p) => !p.folder) ? [''] : [])].map((f) => (
              <button key={f || '_'} className={'type-row' + (folder === f ? ' on' : '')} onClick={() => setFolder(f)}>
                <span className="tname">📁 {f || 'Ohne Ordner'}</span>
                <span className="cnt">{d.plans.filter((p) => p.folder === f).length}</span>
              </button>
            ))}
          </div>
          <div className="col-f">
            <button className="btn" onClick={addFolder}>
              + Ordner
            </button>
          </div>
        </div>
        <div className="plan-list">
          {!list.length && <div className="empty">Noch keine Pläne{folder ? ' in diesem Ordner' : ''}. Mit „+ Plan“ PDF- oder Bilddateien hochladen.</div>}
          {groups.map((g) => (
            <div key={g || '_'}>
              <div className="grp">📁 {g || 'Ohne Ordner'}</div>
              <div className="tablewrap" style={{ marginBottom: 14 }}>
                <table className="list">
                  <thead>
                    <tr>
                      <th style={{ width: 30 }} />
                      <th>Planname</th>
                      <th>Index</th>
                      <th>Maßstab</th>
                      <th>Plandatum</th>
                      <th>Stichworte</th>
                      <th>Lage</th>
                      <th className="c">Marker</th>
                      <th className="c">Aktiv</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {list
                      .filter((p) => p.folder === g)
                      .map((p) => (
                        <tr key={p.id} className="click" onClick={() => setView({ plan: p })}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={sel.includes(p.id)} onChange={(e) => setSel(e.target.checked ? [...sel, p.id] : sel.filter((x) => x !== p.id))} />
                          </td>
                          <td>
                            <b>{p.name}</b>
                            {!!p.versions.length && <span className="muted small"> · {p.versions.length} ältere Stände</span>}
                          </td>
                          <td>{p.index}</td>
                          <td className="small">{p.scale}</td>
                          <td className="small">{fmtDate(p.planDate)}</td>
                          <td className="small muted">{p.keywords}</td>
                          <td className="small">{p.location}</td>
                          <td className="c">{markerCount(p.id) || ''}</td>
                          <td className="c" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" checked={p.active} onChange={(e) => save<Plan>('plan', p.id, { active: e.target.checked })} />
                          </td>
                          <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                            <button className="btn small" onClick={() => setEdit(p)}>
                              Bearbeiten
                            </button>{' '}
                            <label className="btn small" title="Neuen Indexstand hochladen">
                              Neuer Index
                              <input type="file" accept="application/pdf,image/*" hidden onChange={(e) => (e.target.files?.[0] && newIndex(p, e.target.files[0]), (e.target.value = ''))} />
                            </label>{' '}
                            <button className="btn small" title="Herunterladen" onClick={() => download(p)}>
                              ⬇
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
      {edit && <PlanForm plan={edit} folders={folders} onClose={() => setEdit(null)} onView={(v) => setView({ plan: edit, version: v })} onDownload={(v) => download(edit, v)} />}
      {view && (
        <PlanViewer
          plan={view.plan}
          fileId={view.version?.fileId}
          mime={view.version?.mime}
          versionLabel={view.version?.index}
          markers={view.version ? [] : markersFor(view.plan)}
          onMarkerClick={(m) => m.itemId && openItem(m.itemId)}
          onClose={() => setView(null)}
        />
      )}
      {sending && <PlanSendDialog d={d} plans={d.plans.filter((p) => sel.includes(p.id))} onClose={() => setSending(false)} />}
    </div>
  );
}

function PlanForm({ plan, folders, onClose, onView, onDownload }: { plan: Plan; folders: string[]; onClose: () => void; onView: (v: PlanVersion) => void; onDownload: (v: PlanVersion) => void }) {
  const [p, setP] = useState({ name: plan.name, index: plan.index, scale: plan.scale, planDate: plan.planDate || null, keywords: plan.keywords, location: plan.location, folder: plan.folder });
  const f = (k: 'name' | 'index' | 'scale' | 'keywords' | 'location') => ({ value: p[k], onChange: (e: any) => setP({ ...p, [k]: e.target.value }) });
  return (
    <Modal
      title="Plan bearbeiten"
      onClose={onClose}
      actions={
        <>
          <button className="btn danger" onClick={() => confirm('Plan samt allen Indexständen löschen?') && remove('plan', plan.id).then(onClose)}>
            Löschen
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" onClick={() => save<Plan>('plan', plan.id, p).then(onClose)}>
            Speichern
          </button>
        </>
      }
    >
      <label className="f">
        Planname
        <input {...f('name')} />
      </label>
      <div className="grid3">
        <label className="f">
          Index
          <input {...f('index')} />
        </label>
        <label className="f">
          Maßstab
          <input {...f('scale')} placeholder="1:50" />
        </label>
        <label className="f">
          Plandatum
          <DateInput value={p.planDate} onChange={(v) => setP({ ...p, planDate: v })} />
        </label>
      </div>
      <div className="grid2">
        <label className="f">
          Stichworte
          <input {...f('keywords')} placeholder="z.B. Grundriss, Elektro" />
        </label>
        <label className="f">
          Lage
          <input {...f('location')} placeholder="z.B. EG" />
        </label>
      </div>
      <label className="f">
        Ordner
        <select value={p.folder} onChange={(e) => setP({ ...p, folder: e.target.value })}>
          <option value="">Ohne Ordner</option>
          {folders.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      {!!plan.versions.length && (
        <>
          <h3>Ältere Indexstände</h3>
          <table className="list">
            <tbody>
              {plan.versions.map((v, k) => (
                <tr key={k}>
                  <td>Index {v.index || '–'}</td>
                  <td className="small">{fmtDate(v.planDate)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn small" onClick={() => onView(v)}>
                      Ansehen
                    </button>{' '}
                    <button className="btn small" onClick={() => onDownload(v)}>
                      ⬇
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

function PlanSendDialog({ d, plans, onClose }: { d: D; plans: Plan[]; onClose: () => void }) {
  const settings = useSettings();
  const { contactMap } = useGlobal();
  const candidates = d.project!.participants.map((p) => contactMap.get(p.contactId)).filter((c) => c && c.email);
  const [to, setTo] = useState<string[]>([]);
  const [extra, setExtra] = useState('');
  const [subject, setSubject] = useState(`${d.project!.name} – Pläne`);
  const [body, setBody] = useState(
    `Sehr geehrte Damen und Herren,\n\nanbei übermitteln wir Ihnen folgende Pläne zum Projekt ${d.project!.name}:\n\n${plans
      .map((p) => `- ${p.name}${p.index ? ' (Index ' + p.index + ')' : ''}`)
      .join('\n')}\n\nMit freundlichen Grüßen\n${settings.companyName}`,
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      // Dateien liegen bereits auf dem Server – nur die Kennungen übergeben
      const fileIds = plans.map((p) => {
        const ext = p.mime === 'application/pdf' ? '.pdf' : '.' + (p.mime.split('/')[1] || 'bin');
        return { id: p.fileId, filename: `${p.name}${p.index ? '_Index_' + p.index : ''}${ext}` };
      });
      await syncNow(); // noch nicht hochgeladene Pläne zuerst übertragen
      const recipients = [...to, ...extra.split(/[,;\s]+/).filter((x) => x.includes('@'))];
      if (!recipients.length) throw new Error('Bitte mindestens einen Empfänger angeben.');
      await api('/api/mail/send', { body: { to: recipients, subject, text: body, fileIds } });
      alert(`Pläne an ${recipients.length} Empfänger versendet.`);
      onClose();
    } catch (e: any) {
      setErr(e.status ? e.message : e.message && !/fetch|network/i.test(e.message) ? e.message : 'Keine Verbindung zum Server – der Versand ist nur online möglich.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={plans.length === 1 ? '1 Plan versenden' : `${plans.length} Pläne versenden`}
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={busy || (!to.length && !extra)} onClick={send}>
            {busy ? 'Sende…' : 'Senden'}
          </button>
        </>
      }
    >
      {err && <div className="notice red">{err}</div>}
      <h3>Empfänger</h3>
      <div className="grid2" style={{ maxHeight: 220, overflowY: 'auto' }}>
        {candidates.map((c) => (
          <label key={c!.id} className="check">
            <input type="checkbox" checked={to.includes(c!.email!)} onChange={(e) => setTo(e.target.checked ? [...to, c!.email!] : to.filter((x) => x !== c!.email))} />
            {contactName(c)} <span className="muted small">{c!.email}</span>
          </label>
        ))}
      </div>
      <label className="f" style={{ marginTop: 8 }}>
        Weitere Empfänger
        <input value={extra} onChange={(e) => setExtra(e.target.value)} />
      </label>
      <label className="f">
        Betreff
        <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="f">
        Text
        <textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
    </Modal>
  );
}
