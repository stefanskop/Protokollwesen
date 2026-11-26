// Mängelmanagement je Projekt
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { save } from '../db';
import { api } from '../api';
import { useProjectData, useProjects, useGlobal, useSettings, blobToDataUrl, addFile } from '../data';
import { generateDefectPdf } from '../defectpdf';
import { Modal, DateInput } from '../components/ui';
import { PlanViewer, type ViewerMarker } from '../components/PlanViewer';
import { rememberProject, SyncBadge, useUser } from '../App';
import { ProjectTabs } from '../components/ProjectTabs';
import { ItemDetail, statusPatch } from './Workspace';
import {
  fmtDate,
  todayIso,
  contactName,
  isProtocolLocked,
  itemCode,
  nextItemSeq,
  nextProtocolSeq,
  protocolCode,
  previousProtocol,
  STATUS_LABEL,
  type Item,
  type Entry,
  type Protocol,
  type Plan,
  type ItemStatus,
} from '../../../shared/src/index';

type D = ReturnType<typeof useProjectData>;
const STATUS_COLOR: Record<string, string> = { offen: '#e53935', behoben: '#f59e0b', erledigt: '#2e8b57', info: '#2979ff' };
const euro = (n: number) => n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' });

export function DefectsPage() {
  const { pid } = useParams();
  const nav = useNavigate();
  const user = useUser();
  const d = useProjectData(pid);
  const { projects } = useProjects();
  const { companyMap, contactMap } = useGlobal();
  const settings = useSettings();
  useEffect(() => {
    if (pid) rememberProject(pid);
  }, [pid]);

  const [status, setStatus] = useState<'aktiv' | 'alle' | ItemStatus>('aktiv');
  const [company, setCompany] = useState('');
  const [trade, setTrade] = useState('');
  const [loc, setLoc] = useState('');
  const [overdue, setOverdue] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const [planView, setPlanView] = useState<Plan | null>(null);
  const [choosePlan, setChoosePlan] = useState(false);
  const [notice, setNotice] = useState(false);
  const [busy, setBusy] = useState('');

  const defects = useMemo(() => d.items.filter((i) => i.defect), [d.items]);
  const today = todayIso();
  const ql = q.toLowerCase();
  const list = defects
    .filter((i) => (status === 'aktiv' ? i.status === 'offen' || i.status === 'behoben' : status === 'alle' ? true : i.status === status))
    .filter((i) => !company || (company === '-' ? !i.companyId : i.companyId === company))
    .filter((i) => !trade || i.trade === trade)
    .filter((i) => !loc || i.location === loc)
    .filter((i) => !overdue || ((i.dueTo || i.dueFrom || '9999') < today && i.status === 'offen'))
    .filter((i) => !q || `${i.code} ${i.title} ${i.location} ${i.defectType}`.toLowerCase().includes(ql))
    .sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }));

  if (!d.loaded) return null;
  if (!d.project) return <div className="empty">Projekt nicht gefunden.</div>;
  const project = d.project;
  const defectTypes = settings.protocolTypes.filter((t) => t.defects && t.active);

  /** jüngstes Protokoll, in dem der Mangel vorkommt */
  const protoOf = (itemId: string) => d.protocols.filter((p) => p.itemIds.includes(itemId)).sort((a, b) => b.date.localeCompare(a.date) || b.seq - a.seq)[0];
  const count = (st: string) => defects.filter((i) => i.status === st).length;
  const overdueCount = defects.filter((i) => (i.dueTo || i.dueFrom || '9999') < today && i.status === 'offen').length;
  const costSum = list.reduce((n, i) => n + (i.cost || 0), 0);
  const uniq = (xs: (string | undefined | null)[]) => [...new Set(xs.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'de'));

  /** offene Mängelbegehung finden oder anlegen, dann Mangel erstellen */
  const newDefect = async () => {
    const t = defectTypes[0];
    if (!t) return alert('Keine Protokollart für Mängel aktiv (Einstellungen → Protokollarten).');
    let proto = d.protocols.filter((p) => defectTypes.some((x) => x.key === p.typeKey) && p.status === 'entwurf').sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!proto) {
      if (!confirm(`Es gibt keine offene Mängelbegehung. Neue „${t.name}“ mit heutigem Datum anlegen?`)) return;
      const seq = nextProtocolSeq(project.id, t.key, d.protocols);
      const prev = previousProtocol({ projectId: project.id, typeKey: t.key, seq }, d.protocols);
      const carry = prev ? prev.itemIds.filter((id) => ['offen', 'behoben'].includes(d.itemMap.get(id)?.status || '')) : [];
      const id = await save<Protocol>(
        'protocol',
        null,
        {
          typeKey: t.key,
          mode: t.mode,
          seq,
          code: protocolCode(t.prefix, seq),
          title: t.name,
          date: today,
          timeFrom: '',
          timeTo: '',
          location: project.address,
          status: 'entwurf',
          attendees: prev ? prev.attendees.map((a) => ({ ...a, present: false })) : project.participants.map((p) => ({ contactId: p.contactId, distribution: p.defaultDistribution, present: false })),
          groupBy: 'trade',
          itemIds: carry,
          nextMeeting: null,
          endText: null,
          snapshot: null,
        },
        project.id,
      );
      proto = { id, code: protocolCode(t.prefix, seq), itemIds: carry, date: today } as Protocol;
    }
    const cur = sel ? d.itemMap.get(sel) : undefined;
    const itemId = await save<Item>(
      'item',
      null,
      {
        originProtocolId: proto.id,
        code: itemCode(proto.code, nextItemSeq(proto, d.items)),
        title: '',
        status: 'offen',
        priority: 'normal',
        observerIds: [],
        defect: true,
        defectType: settings.defectTypes[0],
        location: cur?.location || loc || undefined,
        trade: cur?.trade || trade || undefined,
        companyId: cur?.companyId || (company && company !== '-' ? company : null),
        category: settings.categories.find((c) => /qualit|mängel/i.test(c)) || settings.categories[0],
        dueTo: new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      },
      project.id,
    );
    await save<Entry>('entry', null, { itemId, protocolId: proto.id, date: proto.date, text: null, addendum: false, fileIds: [] }, project.id);
    await save<Protocol>('protocol', proto.id, { itemIds: [...proto.itemIds, itemId] });
    setStatus('aktiv');
    setSel(itemId);
    setTimeout(() => document.querySelector<HTMLInputElement>('.detail .kurztext input')?.focus(), 250);
  };

  const listPdf = async () => {
    setBusy('Erstelle Mängelliste…');
    const w = window.open('', '_blank');
    try {
      const info = [
        status === 'aktiv' ? 'offene und behoben gemeldete Mängel' : status === 'alle' ? 'alle Mängel' : STATUS_LABEL[status],
        company && (company === '-' ? 'ohne Firma' : companyMap.get(company)?.name),
        trade && 'Gewerk ' + trade,
        loc && 'Lage ' + loc,
        overdue && 'nur überfällige',
      ]
        .filter(Boolean)
        .join(' · ');
      const { blob } = await generateDefectPdf({ projectId: project.id, itemIds: list.map((i) => i.id), title: 'Mängelliste', filterInfo: 'Auswahl: ' + info });
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url;
      else location.href = url;
    } catch (e: any) {
      w?.close();
      alert('PDF konnte nicht erstellt werden: ' + e.message);
    } finally {
      setBusy('');
    }
  };

  const planMarkers = (plan: Plan): ViewerMarker[] =>
    list.flatMap((i) =>
      (i.planMarkers || [])
        .filter((m) => m.planId === plan.id)
        .map((m) => ({ marker: m, label: i.code, title: `${i.title} (${STATUS_LABEL[i.status]})`, itemId: i.id, color: STATUS_COLOR[i.status], highlight: i.id === sel })),
    );
  const plansWithDefects = d.plans
    .filter((p) => p.active)
    .map((p) => ({ p, n: list.filter((i) => i.planMarkers?.some((m) => m.planId === p.id)).length }))
    .sort((a, b) => b.n - a.n);

  const selItem = sel ? d.itemMap.get(sel) : undefined;
  const selProto = sel ? protoOf(sel) : undefined;

  return (
    <div className="ws-wrap">
      <div className="ws-top">
        <span className="ws-title"><i className="fa-solid fa-triangle-exclamation" /> Mängel</span>
        <div className="grow" />
        {busy && <span className="badge orange">{busy}</span>}
        <button className="btn" onClick={() => setChoosePlan(true)} disabled={!d.plans.length} title="Mängel im Plan anzeigen">
          🗺 Im Plan
        </button>
        <button className="btn" onClick={listPdf} disabled={!list.length}>
          Mängelliste PDF
        </button>
        <button className="btn" onClick={() => setNotice(true)} disabled={!defects.some((i) => i.status === 'offen')}>
          ✉ Mängelrüge
        </button>
        <button className="btn primary" onClick={newDefect}>
          + Mangel
        </button>
      </div>

      <div className="defects">
        <div className="defect-list">
          <div className="stats">
            <button className={'stat' + (status === 'offen' ? ' on' : '')} onClick={() => setStatus('offen')}>
              <b style={{ color: STATUS_COLOR.offen }}>{count('offen')}</b> offen
            </button>
            <button className={'stat' + (status === 'behoben' ? ' on' : '')} onClick={() => setStatus('behoben')}>
              <b style={{ color: STATUS_COLOR.behoben }}>{count('behoben')}</b> behoben gemeldet
            </button>
            <button className={'stat' + (status === 'erledigt' ? ' on' : '')} onClick={() => setStatus('erledigt')}>
              <b style={{ color: STATUS_COLOR.erledigt }}>{count('erledigt')}</b> erledigt
            </button>
            <button className={'stat' + (overdue ? ' on' : '')} onClick={() => setOverdue(!overdue)}>
              <b style={{ color: STATUS_COLOR.offen }}>{overdueCount}</b> überfällig
            </button>
            {!!costSum && (
              <span className="stat">
                Abzüge <b>{euro(costSum)}</b>
              </span>
            )}
          </div>
          <div className="filters">
            <input placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
            <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="aktiv">offen + behoben gemeldet</option>
              <option value="offen">offen</option>
              <option value="behoben">behoben gemeldet</option>
              <option value="erledigt">erledigt</option>
              <option value="alle">alle</option>
            </select>
            <select value={company} onChange={(e) => setCompany(e.target.value)}>
              <option value="">alle Firmen</option>
              {uniq(defects.map((i) => i.companyId)).map((c) => (
                <option key={c} value={c}>
                  {companyMap.get(c)?.name || c}
                </option>
              ))}
              <option value="-">ohne Firma</option>
            </select>
            <select value={trade} onChange={(e) => setTrade(e.target.value)}>
              <option value="">alle Gewerke</option>
              {uniq(defects.map((i) => i.trade)).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <select value={loc} onChange={(e) => setLoc(e.target.value)}>
              <option value="">alle Lagen</option>
              {uniq(defects.map((i) => i.location)).map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          {!defects.length && (
            <div className="empty">
              Noch keine Mängel. Mit „+ Mangel“ erfassen. Neue Punkte in Mängelbegehungen und Abnahmen gelten automatisch als Mangel; jeder andere Punkt kann über „Als Mangel führen“ übernommen werden.
            </div>
          )}
          {!!defects.length && !list.length && <div className="empty">Keine Mängel für diese Auswahl.</div>}
          {list.map((i) => {
            const due = i.dueTo || i.dueFrom;
            const late = !!due && due < today && i.status === 'offen';
            return (
              <div key={i.id} className={'defect-row' + (sel === i.id ? ' on' : '')} style={{ borderLeftColor: STATUS_COLOR[i.status] }} onClick={() => setSel(i.id)}>
                <div className="dr-main">
                  <div className="dr-top">
                    <span className="pfx">{i.code}</span>
                    <b>{i.title || <i className="muted">(ohne Kurztext)</i>}</b>
                  </div>
                  <div className="dr-meta">
                    <span>🏢 {i.companyId ? companyMap.get(i.companyId)?.name : '–'}</span>
                    {i.responsibleId && <span>👤 {contactName(contactMap.get(i.responsibleId))}</span>}
                    {i.location && <span>📍 {i.location}</span>}
                    {i.trade && <span>⚒ {i.trade}</span>}
                    {i.defectType && <span>{i.defectType}</span>}
                    {!!i.cost && <span>€ {euro(i.cost)}</span>}
                    {!!i.planMarkers?.length && <span title="im Plan verortet">🗺</span>}
                  </div>
                </div>
                <div className="dr-side">
                  <span className={'badge ' + (i.status === 'erledigt' ? 'green' : i.status === 'behoben' ? 'orange' : 'red')}>{STATUS_LABEL[i.status]}</span>
                  <span className={'small' + (late ? ' overdue' : ' muted')}>{due ? (late ? 'überfällig ' : 'Frist ') + fmtDate(due) : ''}</span>
                  <span className="dr-actions" onClick={(e) => e.stopPropagation()}>
                    {i.status === 'offen' && (
                      <button className="btn small" onClick={() => save<Item>('item', i.id, statusPatch(i, 'behoben'))}>
                        behoben gemeldet
                      </button>
                    )}
                    {i.status === 'behoben' && (
                      <>
                        <button className="btn small" onClick={() => save<Item>('item', i.id, statusPatch(i, 'offen'))} title="Prüfung negativ – wieder offen">
                          ✗ nicht behoben
                        </button>
                        <button className="btn small primary" onClick={() => save<Item>('item', i.id, statusPatch(i, 'erledigt'))}>
                          ✓ abgenommen
                        </button>
                      </>
                    )}
                    {i.status === 'erledigt' && (
                      <button className="btn small ghost" onClick={() => save<Item>('item', i.id, statusPatch(i, 'offen'))}>
                        wieder öffnen
                      </button>
                    )}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="defect-detail">
          {selItem && selProto ? (
            <>
              {isProtocolLocked(selProto) && (
                <div className="notice blue small" style={{ margin: '10px 10px 0' }}>
                  🔒 {selProto.code} ist abgeschlossen. Status über die Knöpfe in der Liste ändern, weitere Einträge in der nächsten Mängelbegehung.
                </div>
              )}
              <ItemDetail key={selItem.id} d={d} protocol={selProto} item={selItem} locked={isProtocolLocked(selProto)} onBack={() => setSel(null)} onRemoved={() => setSel(null)} />
            </>
          ) : (
            <div className="empty">Mangel auswählen oder mit „+ Mangel“ neu erfassen.</div>
          )}
        </div>
      </div>

      {choosePlan && (
        <Modal title="Plan wählen" onClose={() => setChoosePlan(false)}>
          <table className="list">
            <tbody>
              {plansWithDefects.map(({ p, n }) => (
                <tr key={p.id} className="click" onClick={() => (setChoosePlan(false), setPlanView(p))}>
                  <td>
                    <b>{p.name}</b> {p.index && <span className="muted small">Index {p.index}</span>}
                  </td>
                  <td className="small muted">{p.folder}</td>
                  <td className="c">{n ? <span className="badge red">{n} Mängel</span> : <span className="muted small">keine</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Modal>
      )}
      {planView && (
        <PlanViewer
          plan={planView}
          markers={planMarkers(planView)}
          onMarkerClick={(m) => {
            if (m.itemId) setSel(m.itemId);
            setPlanView(null);
          }}
          onClose={() => setPlanView(null)}
        />
      )}
      {notice && <NoticeDialog d={d} onClose={() => setNotice(false)} user={user.name} />}
    </div>
  );
}

/** Aufforderung zur Mängelbehebung je Firma per E-Mail */
function NoticeDialog({ d, onClose, user }: { d: D; onClose: () => void; user: string }) {
  const settings = useSettings();
  const { companyMap, contacts } = useGlobal();
  const open = d.items.filter((i) => i.defect && i.status === 'offen' && i.companyId);
  const companies = [...new Set(open.map((i) => i.companyId!))].sort((a, b) => (companyMap.get(a)?.name || '').localeCompare(companyMap.get(b)?.name || '', 'de'));
  const [cid, setCid] = useState(companies[0] || '');
  const [deadline, setDeadline] = useState<string | null>(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const items = open.filter((i) => i.companyId === cid);
  const participantIds = new Set(d.project!.participants.map((p) => p.contactId));
  const recipients = contacts.filter((c) => c.companyId === cid && c.email).sort((a, b) => Number(participantIds.has(b.id)) - Number(participantIds.has(a.id)));
  const [to, setTo] = useState<string[]>([]);
  useEffect(() => setTo(recipients.filter((c) => participantIds.has(c.id)).map((c) => c.email!)), [cid, recipients.length]);
  const defaultText = () =>
    `Bei der Prüfung Ihrer Leistungen im Bauvorhaben ${d.project!.name} wurden die nachstehend angeführten Mängel festgestellt (${items.length} Position${items.length === 1 ? '' : 'en'}). ` +
    `Gemäß ÖNORM B 2110 bzw. den vertraglichen Vereinbarungen fordern wir Sie auf, diese Mängel bis spätestens ${fmtDate(deadline)} fachgerecht zu beheben und uns die Behebung schriftlich zu melden. ` +
    `Sollte die Behebung nicht fristgerecht erfolgen, behalten wir uns vor, die Mängel im Wege der Ersatzvornahme auf Ihre Kosten beheben zu lassen.`;
  const [text, setText] = useState(defaultText());
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (!edited) setText(defaultText());
  }, [cid, deadline]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const company = companyMap.get(cid);

  const make = () =>
    generateDefectPdf({
      projectId: d.project!.id,
      itemIds: items.map((i) => i.id),
      title: 'Aufforderung zur Mängelbehebung',
      letter: { companyName: company?.name || '', address: company?.address, text, deadline: deadline || undefined },
    });
  const preview = async () => {
    const w = window.open('', '_blank');
    const { blob } = await make();
    const url = URL.createObjectURL(blob);
    if (w) w.location.href = url;
  };
  const send = async () => {
    setBusy('Sende…');
    setErr('');
    try {
      const { blob, filename } = await make();
      await api('/api/mail/send', {
        body: {
          to,
          subject: `${d.project!.name} – Aufforderung zur Mängelbehebung (Frist ${fmtDate(deadline)})`,
          text: `Sehr geehrte Damen und Herren,\n\n${text}\n\nDie Mängelliste finden Sie im Anhang.\n\nMit freundlichen Grüßen\n${user}\n${settings.companyName}`,
          attachments: [{ filename, base64: (await blobToDataUrl(blob)).split(',')[1] }],
        },
      });
      // Frist bei den Mängeln setzen und Schreiben archivieren
      for (const i of items) if (deadline && (!i.dueTo || i.dueTo > deadline)) await save<Item>('item', i.id, { dueTo: deadline });
      await addFile(new File([blob], filename, { type: 'application/pdf' }), d.project!.id, filename);
      alert(`Mängelrüge an ${company?.name} versendet (${to.length} Empfänger).`);
      onClose();
    } catch (e: any) {
      setErr(e.status ? e.message : 'Keine Verbindung zum Server – Versand nur online möglich.');
    } finally {
      setBusy('');
    }
  };
  return (
    <Modal
      title="Aufforderung zur Mängelbehebung"
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={preview} disabled={!items.length}>
            Vorschau
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button className="btn primary" disabled={!!busy || !to.length || !items.length} onClick={send}>
            {busy || 'Senden'}
          </button>
        </>
      }
    >
      {err && <div className="notice red">{err}</div>}
      <div className="grid2">
        <label className="f">
          Firma
          <select value={cid} onChange={(e) => setCid(e.target.value)}>
            {companies.map((c) => (
              <option key={c} value={c}>
                {companyMap.get(c)?.name} ({open.filter((i) => i.companyId === c).length} offen)
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Frist zur Behebung
          <DateInput value={deadline} onChange={setDeadline} />
        </label>
      </div>
      <h3>Empfänger</h3>
      {!recipients.length && <div className="muted small">Für diese Firma ist kein Kontakt mit E-Mail-Adresse erfasst.</div>}
      <div className="grid2">
        {recipients.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={to.includes(c.email!)} onChange={(e) => setTo(e.target.checked ? [...to, c.email!] : to.filter((x) => x !== c.email))} />
            {contactName(c)} <span className="muted small">{c.email}</span>
          </label>
        ))}
      </div>
      <label className="f" style={{ marginTop: 8 }}>
        Text
        <textarea
          rows={6}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setEdited(true);
          }}
        />
      </label>
      <div className="muted small">
        Angehängt wird eine Mängelliste mit {items.length} offenen Mängeln dieser Firma (inkl. Foto und Planausschnitt). Die Frist wird bei den Mängeln eingetragen, das Schreiben im Projekt archiviert.
      </div>
    </Modal>
  );
}
