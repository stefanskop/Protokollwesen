// Arbeitsansicht: Projekt → Protokollart → Protokoll → Punkt → Bearbeitung
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom';
import { save, remove, getRec } from '../db';
import { useProjectData, useProjects, useGlobal, useSettings, addFile, useFileUrlEx } from '../data';
import { generateProtocolPdf } from '../pdfgen';
import { LazyInput, RichEditor, RichView, ContactSelect, ListSelect, DateInput, Modal } from '../components/ui';
import { SyncBadge, useUser } from '../App';
import { NewProtocol } from './Project';
import { SketchEditor } from '../components/Sketch';
import { AttendeesTab, HeadTab, NextMeetingTab, SendDialog, AdoptDialog } from './Protocol';
import {
  fmtDate,
  todayIso,
  isoWeek,
  contactName,
  groupedItems,
  entriesForItemInProtocol,
  isProtocolLocked,
  itemCode,
  nextItemSeq,
  projectLists,
  makeSnapshot,
  itemInProtocol,
  type Protocol,
  type Item,
  type Entry,
  type GroupBy,
  type FileMeta,
} from '../../../shared/src/index';

type D = ReturnType<typeof useProjectData>;

function usePref<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : init;
    } catch {
      return init;
    }
  });
  return [
    v,
    (n: T) => {
      setV(n);
      try {
        localStorage.setItem(key, JSON.stringify(n));
      } catch {}
    },
  ];
}

const dueText = (iso?: string | null) => (iso ? `KW ${isoWeek(iso)} | ${fmtDate(iso).slice(0, 6)}${iso.slice(2, 4)}` : '');

export function Workspace() {
  const { pid } = useParams();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const user = useUser();
  const d = useProjectData(pid);
  const { projects } = useProjects();
  const settings = useSettings();
  const [showClosed, setShowClosed] = usePref('pw.showClosed', true);
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<'' | 'daten' | 'senden' | 'uebernehmen'>('');
  const [busy, setBusy] = useState(false);

  const typeKey = sp.get('art') || '';
  const select = (patch: Record<string, string | null>) => {
    const n = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
    setSp(n, { replace: true });
  };

  const typeName = (k: string) => settings.protocolTypes.find((t) => t.key === k)?.name || k;
  const lists = d.project ? projectLists(d.project, settings) : null;
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of d.protocols) m.set(p.typeKey, (m.get(p.typeKey) || 0) + 1);
    return m;
  }, [d.protocols]);
  const protocols = d.protocols
    .filter((p) => !typeKey || p.typeKey === typeKey)
    .filter((p) => showClosed || p.status !== 'abgeschlossen' || p.id === sp.get('p'))
    .sort((a, b) => (a.date === b.date ? b.seq - a.seq : b.date.localeCompare(a.date)));
  const protocol = (sp.get('p') && d.protocolMap.get(sp.get('p')!)) || protocols[0];
  const itemId = sp.get('i');

  if (!d.loaded) return null;
  if (!d.project) return <div className="empty">Projekt nicht gefunden (evtl. noch nicht synchronisiert).</div>;
  const project = d.project;
  const locked = protocol ? isProtocolLocked(protocol) : false;

  const close = async () => {
    if (!protocol) return;
    if (!confirm(protocol.mode === 'fortlaufend' ? 'Protokoll abschließen? Die Inhalte werden danach gesperrt.' : 'Protokoll als abgeschlossen markieren?')) return;
    await save<Protocol>('protocol', protocol.id, {
      status: 'abgeschlossen',
      closedAt: new Date().toISOString(),
      closedBy: user.id,
      snapshot: protocol.mode === 'fortlaufend' ? makeSnapshot(protocol, d.itemMap) : null,
    });
  };
  const unlock = async () => {
    if (protocol && confirm('Protokoll wieder freischalten? Änderungen sind danach wieder möglich.')) await save<Protocol>('protocol', protocol.id, { status: 'entwurf', snapshot: null });
  };
  const preview = async () => {
    if (!protocol) return;
    setBusy(true);
    const w = window.open('', '_blank');
    try {
      const { blob } = await generateProtocolPdf(protocol.id);
      const url = URL.createObjectURL(blob);
      if (w) w.location.href = url;
      else location.href = url;
    } catch (e: any) {
      w?.close();
      alert('PDF konnte nicht erstellt werden: ' + e.message);
    } finally {
      setBusy(false);
    }
  };

  const newItem = async () => {
    if (!protocol || locked || !lists) return;
    const seq = nextItemSeq(protocol, d.items);
    const cur = itemId ? d.itemMap.get(itemId) : undefined;
    const cat = cur?.category || lists.categories[0];
    const id = await save<Item>(
      'item',
      null,
      { originProtocolId: protocol.id, code: itemCode(protocol.code, seq), title: '', status: 'info', priority: 'normal', observerIds: [], category: cat, itemType: cur?.itemType || cat },
      protocol.projectId,
    );
    await save<Entry>('entry', null, { itemId: id, protocolId: protocol.id, date: protocol.date, text: null, addendum: false, fileIds: [] }, protocol.projectId);
    await save<Protocol>('protocol', protocol.id, { itemIds: [...protocol.itemIds, id] });
    select({ p: protocol.id, i: id });
    setTimeout(() => document.querySelector<HTMLInputElement>('.detail .kurztext input')?.focus(), 200);
  };

  const wsClass = ['ws', itemId ? 'has-item' : ''].join(' ');
  return (
    <div className="ws-wrap">
      <div className="ws-top">
        <select className="proj-select" value={project.id} onChange={(e) => nav('/p/' + e.target.value)}>
          {projects
            .filter((p) => !p.archived || p.id === project.id)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.number ? p.number + ' ' : ''}
                {p.name}
              </option>
            ))}
        </select>
        <Link className="btn" to={`/p/${project.id}/projekt`} title="Beteiligte, offene Punkte, Projektdaten">
          Projekt
        </Link>
        <label className="toggle">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Abgeschlossene
        </label>
        <div className="grow" />
        {protocol && (
          <>
            <button className="btn" onClick={() => setDialog('daten')} title="Kopfdaten, Teilnehmer, nächste Besprechung">
              ⚙ Protokolldaten
            </button>
            <button className="btn" disabled={busy} onClick={preview}>
              Vorschau
            </button>
            <button className="btn" onClick={() => setDialog('senden')}>
              ✉ Senden
            </button>
            {protocol.status === 'entwurf' ? (
              <button className="btn primary" onClick={close}>
                Abschließen
              </button>
            ) : (
              (user.role === 'admin' || protocol.mode === 'standard') && (
                <button className="btn" onClick={unlock}>
                  🔓 Freischalten
                </button>
              )
            )}
          </>
        )}
        <SyncBadge />
      </div>

      <div className={wsClass}>
        {/* Spalte 1: Protokollarten */}
        <div className="ws-col col-types">
          <div className="col-h">Protokollarten</div>
          <div className="col-body">
            <button className={'type-row' + (!typeKey ? ' on' : '')} onClick={() => select({ art: null, p: null, i: null })}>
              <span className="tname">📁 Alle Protokolle</span>
              <span className="cnt">{d.protocols.length}</span>
            </button>
            {lists?.protocolTypes.map((t) => (
              <button key={t.key} className={'type-row' + (typeKey === t.key ? ' on' : '')} onClick={() => select({ art: t.key, p: null, i: null })}>
                <span className="tmeta">
                  <span className="pfx">{t.prefix}</span> {t.mode === 'fortlaufend' ? 'Fortlaufend' : 'Standard'}
                </span>
                <span className="tname">{t.name}</span>
                <span className="cnt">{counts.get(t.key) || 0}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Spalte 2: Protokolle */}
        <div className="ws-col col-protocols">
          <div className="col-h">
            <select className="compact-only" value={typeKey} onChange={(e) => select({ art: e.target.value || null, p: null, i: null })}>
              <option value="">Alle Protokollarten</option>
              {lists?.protocolTypes.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
            <span className="wide-only">Protokolle</span>
          </div>
          <div className="col-body">
            {!protocols.length && <div className="empty small">Keine Protokolle.</div>}
            {protocols.map((p) => {
              const open = p.itemIds.filter((id) => itemInProtocol(d.itemMap.get(id) || ({} as Item), p).status === 'offen').length;
              return (
                <button key={p.id} className={'proto-card' + (protocol?.id === p.id ? ' on' : '')} onClick={() => select({ p: p.id, i: null })}>
                  <div className="pc-top">
                    <span className="pfx">{p.code}</span>
                    <span className="muted small">{p.mode === 'fortlaufend' ? 'Fortlaufend' : 'Standard'}</span>
                  </div>
                  <div className="pc-title">{p.title || typeName(p.typeKey)}</div>
                  <div className="pc-meta">
                    <span>{fmtDate(p.date)}</span>
                    <span>
                      Einträge <span className="badge blue">{p.itemIds.length}</span>
                    </span>
                    <span>
                      Offen <span className="badge red">{open}</span>
                    </span>
                    <span className="icons">
                      {p.status === 'abgeschlossen' && <span title="abgeschlossen">🔒</span>}
                      {p.sentAt && <span title={'versendet ' + fmtDate(p.sentAt)}>✉</span>}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="col-f">
            <button className="btn primary" onClick={() => setCreating(true)}>
              + Protokoll erstellen
            </button>
          </div>
        </div>

        {/* Spalte 3: Punkte */}
        <ItemsColumn d={d} protocol={protocol} locked={locked} itemId={itemId} onSelect={(i) => select({ p: protocol?.id || null, i })} onNew={newItem} onAdopt={() => setDialog('uebernehmen')} protocols={protocols} onProtocol={(id) => select({ p: id, i: null })} />

        {/* Spalte 4: Bearbeitung */}
        <div className="ws-col col-detail">
          {protocol && itemId && d.itemMap.get(itemId) ? (
            <ItemDetail key={itemId} d={d} protocol={protocol} item={d.itemMap.get(itemId)!} locked={locked} onBack={() => select({ i: null })} onRemoved={() => select({ i: null })} />
          ) : (
            <div className="empty">{protocol ? 'Punkt auswählen oder neu erstellen.' : 'Protokoll auswählen oder erstellen.'}</div>
          )}
        </div>
      </div>

      {creating && <NewProtocol d={d} initialType={typeKey || undefined} onClose={() => setCreating(false)} onCreated={(id) => (setCreating(false), select({ art: d.protocolMap.get(id)?.typeKey || typeKey || null, p: id, i: null }))} />}
      {dialog === 'daten' && protocol && <ProtocolDialog d={d} protocol={protocol} locked={locked} onClose={() => setDialog('')} />}
      {dialog === 'senden' && protocol && <SendDialog d={d} protocol={protocol} typeName={typeName(protocol.typeKey)} onClose={() => setDialog('')} />}
      {dialog === 'uebernehmen' && protocol && <AdoptDialog d={d} protocol={protocol} onClose={() => setDialog('')} />}
    </div>
  );
}

function ProtocolDialog({ d, protocol, locked, onClose }: { d: D; protocol: Protocol; locked: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<'kopf' | 'teilnehmer' | 'naechste'>('kopf');
  return (
    <Modal
      title={`Protokolldaten ${protocol.code}`}
      wide
      onClose={onClose}
      actions={
        <button className="btn primary" onClick={onClose}>
          Fertig
        </button>
      }
    >
      <div className="tabs">
        {(
          [
            ['kopf', 'Kopfdaten & Texte'],
            ['teilnehmer', 'Teilnehmer & Verteiler'],
            ['naechste', 'Nächste Besprechung'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'kopf' && <HeadTab protocol={protocol} locked={locked} />}
      {tab === 'teilnehmer' && <AttendeesTab d={d} protocol={protocol} locked={locked} />}
      {tab === 'naechste' && <NextMeetingTab d={d} protocol={protocol} locked={locked} />}
    </Modal>
  );
}

function ItemsColumn({
  d,
  protocol,
  locked,
  itemId,
  onSelect,
  onNew,
  onAdopt,
  protocols,
  onProtocol,
}: {
  d: D;
  protocol?: Protocol;
  locked: boolean;
  itemId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onAdopt: () => void;
  protocols: Protocol[];
  onProtocol: (id: string) => void;
}) {
  const { companyMap } = useGlobal();
  const [q, setQ] = useState('');
  const groups = useMemo(() => (protocol ? groupedItems(protocol, d.itemMap) : []), [protocol, d.itemMap]);
  const ql = q.toLowerCase();
  const fileCount = (it: Item) => d.entries.filter((e) => e.itemId === it.id && !e.deleted).reduce((n, e) => n + e.fileIds.length, 0);
  return (
    <div className="ws-col col-items">
      <div className="col-h">
        <select className="compact-only" value={protocol?.id || ''} onChange={(e) => onProtocol(e.target.value)}>
          {protocols.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} – {p.title} ({fmtDate(p.date)})
            </option>
          ))}
        </select>
        <input placeholder="Suchen…" value={q} onChange={(e) => setQ(e.target.value)} />
        {protocol && (
          <select
            title="Gliederung"
            value={protocol.groupBy}
            disabled={locked}
            style={{ maxWidth: 130 }}
            onChange={(e) => save<Protocol>('protocol', protocol.id, { groupBy: e.target.value as GroupBy })}
          >
            <option value="category">Zusatzfeld</option>
            <option value="trade">Gewerk</option>
            <option value="itemType">Typ</option>
            <option value="none">ohne</option>
          </select>
        )}
      </div>
      <div className="col-body">
        {protocol && locked && <div className="notice blue small">🔒 Abgeschlossen und gesperrt.</div>}
        {protocol && !groups.length && <div className="empty small">Noch keine Punkte.</div>}
        {groups.map((g) => {
          const items = g.items.filter(
            (i) => !q || `${i.code} ${i.title}`.toLowerCase().includes(ql) || d.entries.some((e) => e.itemId === i.id && JSON.stringify(e.text || '').toLowerCase().includes(ql)),
          );
          if (!items.length) return null;
          return (
            <div key={g.key || '_'}>
              {protocol!.groupBy !== 'none' && <div className="grp">{g.key || 'ohne Zuordnung'}</div>}
              {items.map((it) => {
                const due = it.dueTo || it.dueFrom;
                const fc = fileCount(it);
                return (
                  <button key={it.id} className={['item-card', it.status, it.priority === 'hoch' ? 'hoch' : '', itemId === it.id ? 'on' : ''].join(' ')} onClick={() => onSelect(it.id)}>
                    <div className="ic-top">
                      <span className="pfx">{it.code}</span>
                      <span className="ic-status">{it.status === 'offen' ? 'Offen' : it.status === 'erledigt' ? 'Erledigt ✓' : ''}</span>
                    </div>
                    <div className="ic-title">{it.title || <i className="muted">(ohne Kurztext)</i>}</div>
                    <div className="ic-company">{it.companyId ? companyMap.get(it.companyId)?.name : 'Projektteam'}</div>
                    <div className="ic-meta">
                      <span>⚒ {it.trade || '–'}</span>
                      <span>🏷 {it.category || '–'}</span>
                    </div>
                    <div className="ic-meta">
                      <span className={due && due < todayIso() && it.status === 'offen' ? 'overdue' : ''}>⚑ {due ? dueText(due) : '–'}</span>
                      <span>
                        {fc > 0 && <span title={`${fc} Anhänge`}>📎{fc} </span>}
                        {it.priority === 'hoch' && <span className="prio-dot" title="Hohe Priorität" />}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
      {protocol && !locked && (
        <div className="col-f">
          <button className="btn" onClick={onAdopt}>
            Übernehmen
          </button>
          <button className="btn primary" onClick={onNew}>
            + Punkt erstellen
          </button>
        </div>
      )}
    </div>
  );
}

function ItemDetail({ d, protocol, item: raw, locked, onBack, onRemoved }: { d: D; protocol: Protocol; item: Item; locked: boolean; onBack: () => void; onRemoved: () => void }) {
  const settings = useSettings();
  const { contacts, companies, companyMap, contactMap } = useGlobal();
  const lists = projectLists(d.project!, settings);
  const inProtocol = protocol.itemIds.includes(raw.id);
  const item = itemInProtocol(raw, protocol);
  const ro = locked || !inProtocol;
  const entries = entriesForItemInProtocol(item, protocol, d.entries, d.protocolMap);
  const setItem = (patch: Partial<Item>) => !ro && save<Item>('item', item.id, patch);
  const participantIds = d.project!.participants.map((p) => p.contactId);
  const participantCompanies = new Set(participantIds.map((id) => contactMap.get(id)?.companyId).filter(Boolean) as string[]);
  const companyOptions = [...companies].sort((a, b) => Number(participantCompanies.has(b.id)) - Number(participantCompanies.has(a.id)) || a.name.localeCompare(b.name, 'de'));
  const responsibleIds = item.companyId ? contacts.filter((c) => c.companyId === item.companyId).map((c) => c.id) : participantIds;
  const origin = d.protocolMap.get(item.originProtocolId);

  const newEntry = async () => {
    const today = todayIso();
    const date = today > protocol.date ? today : protocol.date;
    return save<Entry>('entry', null, { itemId: item.id, protocolId: protocol.id, date, text: null, addendum: today > protocol.date, fileIds: [] }, protocol.projectId);
  };
  // Anhänge kommen in den jüngsten bearbeitbaren Eintrag dieses Protokolls
  const attach = async (files: FileList | null) => {
    if (!files?.length || ro) return;
    const target = [...entries].reverse().find((e) => e.protocolId === protocol.id);
    let targetId = target?.id;
    if (!targetId) targetId = await newEntry();
    const ids: string[] = [];
    for (const f of Array.from(files)) ids.push(await addFile(f, protocol.projectId));
    // aktuellen Stand frisch lesen (mehrere Uploads kurz hintereinander)
    const fresh = await getRec<Entry>(targetId);
    await save<Entry>('entry', targetId, { fileIds: [...(fresh?.fileIds || []), ...ids] });
  };
  const removeItem = async () => {
    const isOrigin = item.originProtocolId === protocol.id;
    const elsewhere = d.protocols.some((p) => p.id !== protocol.id && p.itemIds.includes(item.id));
    if (!confirm(isOrigin && !elsewhere ? `Punkt ${item.code} löschen?` : `Punkt ${item.code} aus diesem Protokoll entfernen?`)) return;
    await save<Protocol>('protocol', protocol.id, { itemIds: protocol.itemIds.filter((x) => x !== item.id) });
    for (const e of d.entries.filter((e) => e.itemId === item.id && e.protocolId === protocol.id)) await remove('entry', e.id);
    if (isOrigin && !elsewhere) await remove('item', item.id);
    onRemoved();
  };
  const attachments = entries.flatMap((e) => e.fileIds.map((fid) => ({ fid, entry: e, editable: !ro && e.protocolId === protocol.id })));

  return (
    <div className="detail">
      <div className="d-head">
        <button className="btn small compact-back" onClick={onBack}>
          ← Liste
        </button>
        <div>
          <div className="small muted">
            {d.project!.name} › {protocol.code}
          </div>
          <div className="d-code">
            <span className="pfx">{item.code}</span>
            <span className="small muted">
              erstellt {fmtDate(item.createdAt?.slice(0, 10))} {origin && origin.id !== protocol.id ? `in ${origin.code}` : ''}
            </span>
          </div>
        </div>
        <div className="grow" />
        <label className={'prio-toggle' + (item.priority === 'hoch' ? ' on' : '')}>
          <input type="checkbox" disabled={ro} checked={item.priority === 'hoch'} onChange={(e) => setItem({ priority: e.target.checked ? 'hoch' : 'normal' })} />
          {item.priority === 'hoch' ? 'Hohe Priorität' : 'Keine Priorität'} ⚑
        </label>
        {!ro && (
          <button className="btn small ghost danger" title="Punkt entfernen" onClick={removeItem}>
            🗑
          </button>
        )}
      </div>

      <label className="f kurztext">
        Kurztext
        {ro ? <div className="ro-text">{item.title}</div> : <LazyInput value={item.title} placeholder="Titel des Punktes" onSave={(v) => setItem({ title: v })} />}
      </label>

      <div className="f-label">Langtext</div>
      <div className="entries">
        {entries.map((e) => (
          <EntryBlock key={e.id} d={d} entry={e} editable={!ro && e.protocolId === protocol.id} />
        ))}
        {!ro && (
          <button className="btn small" onClick={newEntry}>
            + Eintrag
          </button>
        )}
      </div>

      <div className="fields">
        <label className="f">
          Firma
          <select value={item.companyId || ''} disabled={ro} onChange={(e) => setItem({ companyId: e.target.value || null, responsibleId: null })}>
            <option value="">Projektteam</option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="f">
          Zuständig
          {ro ? (
            <input disabled value={contactName(item.responsibleId ? contactMap.get(item.responsibleId) : null)} />
          ) : (
            <ContactSelect value={item.responsibleId} contacts={contacts} companies={companyMap} onlyIds={responsibleIds} onChange={(v) => setItem({ responsibleId: v })} />
          )}
        </label>
        <label className="f">
          Beobachter
          <select value="" disabled={ro} onChange={(e) => e.target.value && setItem({ observerIds: [...item.observerIds, e.target.value] })}>
            <option value="">{item.observerIds.length ? item.observerIds.map((id) => companyMap.get(id)?.name || contactName(contactMap.get(id))).join(', ') : '+ hinzufügen…'}</option>
            {companyOptions
              .filter((c) => !item.observerIds.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  + {c.name}
                </option>
              ))}
          </select>
          {!!item.observerIds.length && !ro && (
            <span className="chips" style={{ marginTop: 4 }}>
              {item.observerIds.map((id) => (
                <span key={id} className="chip">
                  {companyMap.get(id)?.name || contactName(contactMap.get(id))}
                  <button type="button" onClick={() => setItem({ observerIds: item.observerIds.filter((x) => x !== id) })}>
                    ×
                  </button>
                </span>
              ))}
            </span>
          )}
        </label>
        <label className="f">
          Typ
          {ro ? <input disabled value={item.itemType || ''} /> : <ListSelect value={item.itemType} options={lists.itemTypes} onChange={(v) => setItem({ itemType: v })} />}
        </label>
        <label className="f">
          Gewerk
          {ro ? <input disabled value={item.trade || ''} /> : <ListSelect value={item.trade} options={lists.trades} onChange={(v) => setItem({ trade: v })} />}
        </label>
        <label className="f">
          Lage
          <LazyInput disabled={ro} value={item.location || ''} placeholder="z.B. EG, Vestibül" onSave={(v) => setItem({ location: v })} />
        </label>
        <label className="f">
          Zusatzfeld
          {ro ? <input disabled value={item.category || ''} /> : <ListSelect value={item.category} options={lists.categories} onChange={(v) => setItem({ category: v })} />}
        </label>
        <label className="f">
          Status
          <select value={item.status} disabled={ro} onChange={(e) => setItem({ status: e.target.value as any, doneAt: e.target.value === 'erledigt' ? todayIso() : null })}>
            <option value="info">Info</option>
            <option value="offen">Offen</option>
            <option value="erledigt">Erledigt</option>
          </select>
        </label>
        <label className="f">
          Zu erledigen von
          <DateInput disabled={ro} value={item.dueFrom} onChange={(v) => setItem({ dueFrom: v })} />
        </label>
        <label className="f">
          Zu erledigen bis
          <DateInput disabled={ro} value={item.dueTo} onChange={(v) => setItem({ dueTo: v })} />
        </label>
      </div>

      <div className="attach">
        <div className="attach-h">
          <b>Anhänge</b> <span className="badge">{attachments.length}</span>
          <div className="grow" />
          {!ro && (
            <>
              <label className="btn small">
                📷 Foto
                <input type="file" accept="image/*" multiple hidden onChange={(e) => (attach(e.target.files), (e.target.value = ''))} />
              </label>
              <label className="btn small">
                📎 Datei
                <input type="file" multiple hidden onChange={(e) => (attach(e.target.files), (e.target.value = ''))} />
              </label>
            </>
          )}
        </div>
        {!attachments.length && <div className="muted small">Keine Anhänge. Fotos erscheinen im PDF, andere Dateien werden namentlich aufgeführt.</div>}
        <div className="attach-list">
          {attachments.map(({ fid, entry, editable }) => (
            <Attachment
              key={fid}
              meta={d.fileMap.get(fid)}
              id={fid}
              editable={editable}
              origin={d.protocolMap.get(entry.protocolId)?.code}
              onRemove={async () => {
                const fresh = await getRec<Entry>(entry.id);
                await save<Entry>('entry', entry.id, { fileIds: (fresh?.fileIds || []).filter((x) => x !== fid) });
              }}
              projectId={protocol.projectId}
              onReplace={async (newId) => {
                const fresh = await getRec<Entry>(entry.id);
                await save<Entry>('entry', entry.id, { fileIds: (fresh?.fileIds || []).map((x) => (x === fid ? newId : x)) });
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function EntryBlock({ d, entry, editable }: { d: D; entry: Entry; editable: boolean }) {
  const proto = d.protocolMap.get(entry.protocolId);
  const set = (patch: Partial<Entry>) => save<Entry>('entry', entry.id, patch);
  return (
    <div className={'entry' + (editable ? '' : ' locked') + (entry.addendum ? ' addendum' : '')}>
      <div className="when">
        <span className="e-label">Eintrag</span>
        {editable ? (
          <>
            <DateInput value={entry.date} onChange={(v) => v && set({ date: v })} style={{ width: 150 }} />
            <label className="check" style={{ margin: 0 }} title="Nachträgliche Ergänzung – wird im PDF kursiv gedruckt">
              <input type="checkbox" checked={entry.addendum} onChange={(e) => set({ addendum: e.target.checked })} /> Ergänzung (kursiv)
            </label>
            <div className="grow" />
            <button className="btn small ghost danger" title="Eintrag löschen" onClick={() => confirm('Eintrag löschen?') && remove('entry', entry.id)}>
              ✕
            </button>
          </>
        ) : (
          <>
            <b>{fmtDate(entry.date)}</b> {proto && <span className="badge">{proto.code}</span>}
          </>
        )}
      </div>
      {editable ? <RichEditor value={entry.text} onSave={(v) => set({ text: v })} placeholder="Text eingeben…" /> : <RichView value={entry.text} />}
    </div>
  );
}

function Attachment({ id, meta, editable, origin, onRemove, onReplace, projectId }: { id: string; meta?: FileMeta; editable: boolean; origin?: string; onRemove: () => void; onReplace: (newId: string) => void; projectId: string }) {
  const [sketch, setSketch] = useState(false);
  const { url, retry } = useFileUrlEx(id);
  const [big, setBig] = useState(false);
  const isImg = meta?.mime?.startsWith('image/');
  useEffect(() => {
    if (!big) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setBig(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [big]);
  const size = meta?.size ? (meta.size > 1e6 ? (meta.size / 1e6).toFixed(1) + ' MB' : Math.round(meta.size / 1e3) + ' kB') : '';
  return (
    <div className="att">
      {isImg ? (
        url ? <img src={url} alt="" onClick={() => setBig(true)} onError={retry} /> : <div className="att-ph">lädt…</div>
      ) : (
        <a className="att-file" href={url} download={meta?.name} target="_blank" rel="noreferrer">
          📄 <span>{meta?.name || 'Datei'}</span>
          <span className="muted small">{size}</span>
        </a>
      )}
      <div className="att-cap">
        {editable ? <LazyInput value={meta?.caption || ''} placeholder="Anmerkung" onSave={(v) => save<FileMeta>('file', id, { caption: v })} /> : <span className="small">{meta?.caption}</span>}
        {origin && <span className="badge">{origin}</span>}
        {editable && isImg && (
          <button className="btn small ghost" title="Zeichnen / markieren" onClick={() => setSketch(true)}>
            ✎
          </button>
        )}
        {editable && (
          <button className="btn small ghost danger" title="Entfernen" onClick={onRemove}>
            ✕
          </button>
        )}
      </div>
      {sketch && <SketchEditor fileId={id} projectId={projectId} onClose={() => setSketch(false)} onSaved={onReplace} />}
      {big && url && (
        <div className="lightbox" onClick={() => setBig(false)}>
          <img src={url} alt="" />
        </div>
      )}
    </div>
  );
}
