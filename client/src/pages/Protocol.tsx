import { useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { save, remove } from '../db';
import { api } from '../api';
import { useProjectData, useGlobal, useSettings, addFile, blobToDataUrl } from '../data';
import { generateProtocolPdf } from '../pdfgen';
import { Modal, LazyInput, LazyTextarea, RichEditor, RichView, ContactSelect, ListSelect, Thumb } from '../components/ui';
import { SyncBadge, useUser } from '../App';
import {
  fmtDate,
  todayIso,
  contactName,
  groupedItems,
  entriesForItemInProtocol,
  isProtocolLocked,
  itemCode,
  nextItemSeq,
  projectLists,
  makeSnapshot,
  fillTemplate,
  itemInProtocol,
  type Protocol,
  type Item,
  type Entry,
  type GroupBy,
  type FileMeta,
} from '../../../shared/src/index';

type D = ReturnType<typeof useProjectData>;

export function ProtocolPage() {
  const { pid, prid } = useParams();
  const d = useProjectData(pid);
  const settings = useSettings();
  const user = useUser();
  const [tab, setTab] = useState<'punkte' | 'teilnehmer' | 'kopf' | 'naechste'>('punkte');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);
  const protocol = prid ? d.protocolMap.get(prid) : undefined;

  useEffect(() => {
    // Sprung zu einem Punkt (aus „Offene Punkte“)
    const h = decodeURIComponent(location.hash.slice(1));
    if (h && d.loaded) setTimeout(() => document.getElementById(h)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
  }, [d.loaded]);

  if (!d.loaded) return null;
  if (!protocol || !d.project) return <div className="empty">Protokoll nicht gefunden.</div>;
  const locked = isProtocolLocked(protocol);
  const typeName = settings.protocolTypes.find((t) => t.key === protocol.typeKey)?.name || protocol.typeKey;
  const set = (patch: Partial<Protocol>) => save<Protocol>('protocol', protocol.id, patch);

  const close = async () => {
    if (!confirm(protocol.mode === 'fortlaufend' ? 'Protokoll abschließen? Die Inhalte werden danach gesperrt.' : 'Protokoll als abgeschlossen markieren?')) return;
    await set({ status: 'abgeschlossen', closedAt: new Date().toISOString(), closedBy: user.id, snapshot: protocol.mode === 'fortlaufend' ? makeSnapshot(protocol, d.itemMap) : null });
  };
  const unlock = async () => {
    if (!confirm('Protokoll wieder freischalten? Änderungen sind danach wieder möglich.')) return;
    await set({ status: 'entwurf', snapshot: null });
  };
  const preview = async () => {
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

  return (
    <>
      <div className="crumbs">
        <Link to="/">Projekte</Link> / <Link to={'/p/' + d.project.id}>{d.project.name}</Link> /
      </div>
      <div className="topbar">
        <h1>
          {typeName} | Nr. {protocol.code}
        </h1>
        {protocol.status === 'abgeschlossen' ? <span className="badge green">abgeschlossen</span> : <span className="badge orange">Entwurf</span>}
        {protocol.sentAt && <span className="badge blue">versendet {fmtDate(protocol.sentAt)}</span>}
        <div className="grow" />
        <SyncBadge />
      </div>
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="muted">
          {protocol.title} · {fmtDate(protocol.date)} {protocol.timeFrom && `· ${protocol.timeFrom}–${protocol.timeTo}`} · {protocol.mode === 'fortlaufend' ? 'fortlaufendes Protokoll' : 'Standardprotokoll'}
        </div>
        <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
          <button className="btn" onClick={preview} disabled={busy}>
            PDF
          </button>
          <button className="btn" onClick={() => setSending(true)}>
            Versenden
          </button>
          {protocol.status === 'entwurf' ? (
            <button className="btn primary" onClick={close}>
              Abschließen
            </button>
          ) : (
            (user.role === 'admin' || protocol.mode === 'standard') && (
              <button className="btn" onClick={unlock}>
                Freischalten
              </button>
            )
          )}
        </div>
      </div>
      {locked && <div className="notice blue">Dieses fortlaufende Protokoll ist abgeschlossen und gesperrt. Ergänzungen erfolgen im nächsten Protokoll{user.role === 'admin' ? ' oder nach dem Freischalten' : ''}.</div>}
      <div className="tabs">
        {(
          [
            ['punkte', `Punkte (${protocol.itemIds.length})`],
            ['teilnehmer', 'Teilnehmer & Verteiler'],
            ['kopf', 'Kopfdaten & Texte'],
            ['naechste', 'Nächste Besprechung'],
          ] as const
        ).map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {l}
          </button>
        ))}
      </div>
      {tab === 'punkte' && <ItemsTab d={d} protocol={protocol} locked={locked} />}
      {tab === 'teilnehmer' && <AttendeesTab d={d} protocol={protocol} locked={locked} />}
      {tab === 'kopf' && <HeadTab protocol={protocol} locked={locked} />}
      {tab === 'naechste' && <NextMeetingTab d={d} protocol={protocol} locked={locked} />}
      {sending && <SendDialog d={d} protocol={protocol} typeName={typeName} onClose={() => setSending(false)} />}
    </>
  );
}

// ---------------------------------------------------------------- Punkte
function ItemsTab({ d, protocol, locked }: { d: D; protocol: Protocol; locked: boolean }) {
  const settings = useSettings();
  const lists = projectLists(d.project!, settings);
  const [q, setQ] = useState('');
  const [adopt, setAdopt] = useState(false);
  const groups = useMemo(() => groupedItems(protocol, d.itemMap), [protocol, d.itemMap]);
  const ql = q.toLowerCase();

  const newItem = async () => {
    const seq = nextItemSeq(protocol, d.items);
    const lastCat = groups.length ? groups[groups.length - 1].items.slice(-1)[0]?.category : undefined;
    const id = await save<Item>(
      'item',
      null,
      { originProtocolId: protocol.id, code: itemCode(protocol.code, seq), title: '', status: 'info', priority: 'normal', observerIds: [], category: lastCat || lists.categories[0], itemType: lastCat || lists.itemTypes[0] },
      protocol.projectId,
    );
    await save<Entry>('entry', null, { itemId: id, protocolId: protocol.id, date: protocol.date, text: null, addendum: false, fileIds: [] }, protocol.projectId);
    await save<Protocol>('protocol', protocol.id, { itemIds: [...protocol.itemIds, id] });
    setTimeout(() => document.getElementById(id)?.querySelector<HTMLInputElement>('.title input')?.focus(), 150);
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
        <input placeholder="Punkte durchsuchen…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320 }} />
        <label className="f" style={{ margin: 0, maxWidth: 220 }}>
          <select value={protocol.groupBy} disabled={locked} onChange={(e) => save<Protocol>('protocol', protocol.id, { groupBy: e.target.value as GroupBy })}>
            <option value="category">Gliederung: Zusatzfeld</option>
            <option value="trade">Gliederung: Gewerk</option>
            <option value="itemType">Gliederung: Typ</option>
            <option value="none">ohne Gliederung</option>
          </select>
        </label>
        <div style={{ flex: 1 }} />
        {!locked && (
          <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
            <button className="btn" onClick={() => setAdopt(true)}>
              Punkt übernehmen
            </button>
            <button className="btn primary" onClick={newItem}>
              + Neuer Punkt
            </button>
          </div>
        )}
      </div>
      {!groups.length && <div className="empty">Noch keine Punkte. Mit „+ Neuer Punkt“ beginnen.</div>}
      {groups.map((g) => {
        const items = g.items.filter((i) => !q || `${i.code} ${i.title}`.toLowerCase().includes(ql) || d.entries.some((e) => e.itemId === i.id && JSON.stringify(e.text || '').toLowerCase().includes(ql)));
        if (!items.length) return null;
        return (
          <div key={g.key || '_'}>
            {protocol.groupBy !== 'none' && <div className="group-h">{g.key || 'ohne Zuordnung'}</div>}
            {items.map((it) => (
              <ItemCard key={it.id} d={d} item={it} protocol={protocol} locked={locked} />
            ))}
          </div>
        );
      })}
      {!locked && groups.length > 0 && (
        <button className="btn primary" onClick={newItem}>
          + Neuer Punkt
        </button>
      )}
      {adopt && <AdoptDialog d={d} protocol={protocol} onClose={() => setAdopt(false)} />}
    </>
  );
}

function ItemCard({ d, item: shown, protocol, locked }: { d: D; item: Item; protocol: Protocol; locked: boolean }) {
  const settings = useSettings();
  const { contacts, companies, companyMap, contactMap } = useGlobal();
  const lists = projectLists(d.project!, settings);
  const item = locked ? shown : itemInProtocol(d.itemMap.get(shown.id)!, protocol);
  const entries = entriesForItemInProtocol(item, protocol, d.entries, d.protocolMap);
  const setItem = (patch: Partial<Item>) => !locked && save<Item>('item', item.id, patch);
  const participantIds = d.project!.participants.map((p) => p.contactId);
  const participantCompanies = new Set(participantIds.map((id) => contactMap.get(id)?.companyId).filter(Boolean) as string[]);
  const companyOptions = [...companies].sort((a, b) => Number(participantCompanies.has(b.id)) - Number(participantCompanies.has(a.id)) || a.name.localeCompare(b.name, 'de'));
  const responsibleIds = item.companyId ? contacts.filter((c) => c.companyId === item.companyId).map((c) => c.id) : participantIds;

  const addEntry = async () => {
    const today = todayIso();
    const date = today > protocol.date ? today : protocol.date;
    await save<Entry>('entry', null, { itemId: item.id, protocolId: protocol.id, date, text: null, addendum: today > protocol.date, fileIds: [] }, protocol.projectId);
  };
  const removeFromProtocol = async () => {
    const isOrigin = item.originProtocolId === protocol.id;
    const ownEntries = d.entries.filter((e) => e.itemId === item.id && e.protocolId !== protocol.id);
    const msg = isOrigin && !ownEntries.length ? `Punkt ${item.code} löschen?` : `Punkt ${item.code} aus diesem Protokoll entfernen?`;
    if (!confirm(msg)) return;
    await save<Protocol>('protocol', protocol.id, { itemIds: protocol.itemIds.filter((x) => x !== item.id) });
    for (const e of d.entries.filter((e) => e.itemId === item.id && e.protocolId === protocol.id)) await remove('entry', e.id);
    if (isOrigin && !ownEntries.length && !d.protocols.some((p) => p.id !== protocol.id && p.itemIds.includes(item.id))) await remove('item', item.id);
  };

  const cls = ['item', item.status, item.priority === 'hoch' ? 'hoch' : ''].join(' ');
  return (
    <div className={cls} id={item.id}>
      <div className="item-head">
        <span className="code">{item.code}</span>
        <div className="title">{locked ? <b>{item.title}</b> : <LazyInput value={item.title} placeholder="Titel des Punktes" onSave={(v) => setItem({ title: v })} />}</div>
        <select value={item.status} disabled={locked} style={{ width: 120 }} onChange={(e) => setItem({ status: e.target.value as any, doneAt: e.target.value === 'erledigt' ? todayIso() : null })}>
          <option value="info">Info</option>
          <option value="offen">Offen</option>
          <option value="erledigt">Erledigt</option>
        </select>
        <label className="check" title="Hohe Priorität" style={{ margin: 0 }}>
          <input type="checkbox" disabled={locked} checked={item.priority === 'hoch'} onChange={(e) => setItem({ priority: e.target.checked ? 'hoch' : 'normal' })} />
          <span style={{ color: 'var(--red)' }}>●</span>
        </label>
        {!locked && (
          <button className="btn small ghost danger" onClick={removeFromProtocol} title="Entfernen">
            ✕
          </button>
        )}
      </div>
      <div className="item-body">
        <div className="item-entries">
          {entries.map((e) => (
            <EntryView key={e.id} d={d} entry={e} editable={!locked && e.protocolId === protocol.id} />
          ))}
          {!locked && (
            <button className="btn small" onClick={addEntry}>
              + Anmerkung
            </button>
          )}
        </div>
        <div className="item-meta">
          <label className="f">
            Firma
            <select value={item.companyId || ''} disabled={locked} onChange={(e) => setItem({ companyId: e.target.value || null, responsibleId: null })}>
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
            {locked ? (
              <input disabled value={contactName(item.responsibleId ? contactMap.get(item.responsibleId) : null)} />
            ) : (
              <ContactSelect value={item.responsibleId} contacts={contacts} companies={companyMap} onlyIds={responsibleIds} onChange={(v) => setItem({ responsibleId: v })} />
            )}
          </label>
          <label className="f">
            Beobachter
            <select
              value=""
              disabled={locked}
              onChange={(e) => e.target.value && setItem({ observerIds: [...item.observerIds, e.target.value] })}
            >
              <option value="">+ hinzufügen…</option>
              {companyOptions.filter((c) => !item.observerIds.includes(c.id)).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {!!item.observerIds.length && (
            <div className="chips" style={{ marginTop: -2, marginBottom: 8 }}>
              {item.observerIds.map((id) => (
                <span key={id} className="chip">
                  {companyMap.get(id)?.name || contactName(contactMap.get(id))}
                  {!locked && <button onClick={() => setItem({ observerIds: item.observerIds.filter((x) => x !== id) })}>×</button>}
                </span>
              ))}
            </div>
          )}
          <div className="grid2">
            <label className="f">
              Typ
              <ListSelect value={item.itemType} options={lists.itemTypes} onChange={(v) => setItem({ itemType: v })} />
            </label>
            <label className="f">
              Zusatzfeld
              <ListSelect value={item.category} options={lists.categories} onChange={(v) => setItem({ category: v })} />
            </label>
          </div>
          <label className="f">
            Gewerk
            <ListSelect value={item.trade} options={lists.trades} onChange={(v) => setItem({ trade: v })} />
          </label>
          {item.status !== 'info' && (
            <div className="grid2">
              <label className="f">
                fällig von
                <input type="date" disabled={locked} value={item.dueFrom || ''} onChange={(e) => setItem({ dueFrom: e.target.value || null })} />
              </label>
              <label className="f">
                fällig bis
                <input type="date" disabled={locked} value={item.dueTo || ''} onChange={(e) => setItem({ dueTo: e.target.value || null })} />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function EntryView({ d, entry, editable }: { d: D; entry: Entry; editable: boolean }) {
  const proto = d.protocolMap.get(entry.protocolId);
  const set = (patch: Partial<Entry>) => save<Entry>('entry', entry.id, patch);
  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const ids: string[] = [];
    for (const f of Array.from(files)) ids.push(await addFile(f, entry.projectId));
    await set({ fileIds: [...entry.fileIds, ...ids] });
  };
  return (
    <div className={'entry' + (editable ? '' : ' locked') + (entry.addendum ? ' addendum' : '')}>
      <div className="when">
        {editable ? (
          <>
            Anm.
            <input type="date" value={entry.date} style={{ width: 150, minHeight: 28, padding: '2px 6px' }} onChange={(e) => set({ date: e.target.value })} />
            <label className="check" style={{ margin: 0 }} title="Nachträgliche Ergänzung – wird kursiv gedruckt">
              <input type="checkbox" checked={entry.addendum} onChange={(e) => set({ addendum: e.target.checked })} /> Ergänzung
            </label>
            <div style={{ flex: 1 }} />
            <label className="btn small" title="Foto / Datei hinzufügen">
              📷 Foto
              <input type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
            </label>
            <button className="btn small ghost danger" title="Anmerkung löschen" onClick={() => confirm('Anmerkung löschen?') && remove('entry', entry.id)}>
              ✕
            </button>
          </>
        ) : (
          <span>
            Anm. {fmtDate(entry.date)}: {proto && <span className="badge">{proto.code}</span>}
          </span>
        )}
      </div>
      {editable ? <RichEditor value={entry.text} onSave={(v) => set({ text: v })} /> : <RichView value={entry.text} />}
      {!!entry.fileIds.length && (
        <div className="photos">
          {entry.fileIds.map((fid) => (
            <Thumb
              key={fid}
              id={fid}
              readOnly={!editable}
              caption={d.fileMap.get(fid)?.caption}
              onCaption={(v) => save<FileMeta>('file', fid, { caption: v })}
              onRemove={() => set({ fileIds: entry.fileIds.filter((x) => x !== fid) })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Punkte aus anderen Protokollen des Projekts in dieses Protokoll übernehmen */
function AdoptDialog({ d, protocol, onClose }: { d: D; protocol: Protocol; onClose: () => void }) {
  const [sel, setSel] = useState<string[]>([]);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const list = d.items
    .filter((i) => !protocol.itemIds.includes(i.id))
    .filter((i) => !onlyOpen || i.status !== 'erledigt')
    .sort((a, b) => a.code.localeCompare(b.code, 'de', { numeric: true }));
  return (
    <Modal
      title="Punkte übernehmen"
      wide
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>
            Abbrechen
          </button>
          <button
            className="btn primary"
            disabled={!sel.length}
            onClick={async () => {
              await save<Protocol>('protocol', protocol.id, { itemIds: [...protocol.itemIds, ...sel] });
              onClose();
            }}
          >
            {sel.length} übernehmen
          </button>
        </>
      }
    >
      <label className="check">
        <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> erledigte ausblenden
      </label>
      <div style={{ maxHeight: '55vh', overflowY: 'auto' }}>
        <table className="list">
          <tbody>
            {list.map((i) => (
              <tr key={i.id} className="click" onClick={() => setSel(sel.includes(i.id) ? sel.filter((x) => x !== i.id) : [...sel, i.id])}>
                <td style={{ width: 30 }}>
                  <input type="checkbox" readOnly checked={sel.includes(i.id)} />
                </td>
                <td className="small" style={{ width: 100 }}>
                  {i.code}
                </td>
                <td>{i.title}</td>
                <td className="small">{i.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="empty">Keine weiteren Punkte im Projekt.</div>}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Teilnehmer
function AttendeesTab({ d, protocol, locked }: { d: D; protocol: Protocol; locked: boolean }) {
  const { contactMap, companyMap } = useGlobal();
  const att = new Map(protocol.attendees.map((a) => [a.contactId, a]));
  const ids = [...new Set([...d.project!.participants.map((p) => p.contactId), ...protocol.attendees.map((a) => a.contactId)])];
  const role = new Map(d.project!.participants.map((p) => [p.contactId, p.role]));
  const rows = ids
    .map((id) => ({ id, c: contactMap.get(id) }))
    .filter((r) => r.c)
    .sort((a, b) => ((a.c!.companyId && companyMap.get(a.c!.companyId)?.name) || '').localeCompare((b.c!.companyId && companyMap.get(b.c!.companyId)?.name) || '', 'de'));
  const toggle = (id: string, k: 'distribution' | 'present', v: boolean) => {
    const cur = att.get(id) || { contactId: id, distribution: false, present: false };
    const next = { ...cur, [k]: v };
    const list = protocol.attendees.some((a) => a.contactId === id) ? protocol.attendees.map((a) => (a.contactId === id ? next : a)) : [...protocol.attendees, next];
    save<Protocol>('protocol', protocol.id, { attendees: list });
  };
  const all = (k: 'distribution' | 'present', v: boolean) =>
    save<Protocol>('protocol', protocol.id, { attendees: ids.map((id) => ({ ...(att.get(id) || { contactId: id, distribution: false, present: false }), [k]: v })) });
  return (
    <>
      <div className="muted small" style={{ marginBottom: 8 }}>
        Beteiligte werden im Projekt (Reiter „Beteiligte“) gepflegt. Hier legen Sie fest, wer anwesend war und wer das Protokoll erhält.
      </div>
      <div className="tablewrap">
        <table className="list">
          <thead>
            <tr>
              <th>Firma</th>
              <th>Name</th>
              <th>Gewerk</th>
              <th>E-Mail</th>
              <th className="c">
                Vert.
                {!locked && (
                  <div>
                    <button className="btn small ghost" onClick={() => all('distribution', true)}>
                      alle
                    </button>
                  </div>
                )}
              </th>
              <th className="c">
                Teil.
                {!locked && (
                  <div>
                    <button className="btn small ghost" onClick={() => all('present', false)}>
                      keine
                    </button>
                  </div>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, c }) => (
              <tr key={id}>
                <td className="small">{(c!.companyId && companyMap.get(c!.companyId)?.name) || ''}</td>
                <td>{contactName(c)}</td>
                <td className="small muted">{role.get(id) || c!.function}</td>
                <td className="small">{c!.email}</td>
                <td className="c">
                  <input type="checkbox" disabled={locked} checked={!!att.get(id)?.distribution} onChange={(e) => toggle(id, 'distribution', e.target.checked)} />
                </td>
                <td className="c">
                  <input type="checkbox" disabled={locked} checked={!!att.get(id)?.present} onChange={(e) => toggle(id, 'present', e.target.checked)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- Kopfdaten
function HeadTab({ protocol, locked }: { protocol: Protocol; locked: boolean }) {
  const settings = useSettings();
  const set = (patch: Partial<Protocol>) => save<Protocol>('protocol', protocol.id, patch);
  return (
    <div className="card">
      <label className="f">
        Bezeichnung
        <LazyInput disabled={locked} value={protocol.title} onSave={(v) => set({ title: v })} />
      </label>
      <div className="grid3">
        <label className="f">
          Datum
          <input type="date" disabled={locked} value={protocol.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label className="f">
          von
          <input type="time" disabled={locked} value={protocol.timeFrom} onChange={(e) => set({ timeFrom: e.target.value })} />
        </label>
        <label className="f">
          bis
          <input type="time" disabled={locked} value={protocol.timeTo} onChange={(e) => set({ timeTo: e.target.value })} />
        </label>
      </div>
      <label className="f">
        Ort
        <LazyInput disabled={locked} value={protocol.location} onSave={(v) => set({ location: v })} />
      </label>
      <label className="f">
        Starttext (optional, erscheint vor den Punkten)
        <LazyTextarea disabled={locked} value={protocol.startText || ''} onSave={(v) => set({ startText: v })} />
      </label>
      <label className="f">
        Endtext
        <LazyTextarea disabled={locked} value={protocol.endText ?? settings.endText} onSave={(v) => set({ endText: v === settings.endText ? null : v })} />
      </label>
      <label className="check">
        <input type="checkbox" disabled={locked} checked={protocol.mode === 'fortlaufend'} onChange={(e) => set({ mode: e.target.checked ? 'fortlaufend' : 'standard' })} />
        Fortlaufendes Protokoll (nach Abschluss gesperrt)
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- Nächste Besprechung
function NextMeetingTab({ d, protocol, locked }: { d: D; protocol: Protocol; locked: boolean }) {
  const { contactMap, companyMap } = useGlobal();
  const nm = protocol.nextMeeting || { date: '', timeFrom: protocol.timeFrom, timeTo: protocol.timeTo, location: protocol.location, note: '', inviteeIds: [] };
  const set = (patch: Partial<NonNullable<Protocol['nextMeeting']>>) => save<Protocol>('protocol', protocol.id, { nextMeeting: { ...nm, ...patch } });
  const ids = d.project!.participants.map((p) => p.contactId);
  return (
    <div className="card">
      <div className="grid3">
        <label className="f">
          Datum
          <input type="date" disabled={locked} value={nm.date} onChange={(e) => set({ date: e.target.value })} />
        </label>
        <label className="f">
          von
          <input type="time" disabled={locked} value={nm.timeFrom} onChange={(e) => set({ timeFrom: e.target.value })} />
        </label>
        <label className="f">
          bis
          <input type="time" disabled={locked} value={nm.timeTo} onChange={(e) => set({ timeTo: e.target.value })} />
        </label>
      </div>
      <label className="f">
        Ort
        <LazyInput disabled={locked} value={nm.location} onSave={(v) => set({ location: v })} />
      </label>
      <label className="f">
        Hinweis
        <LazyInput disabled={locked} value={nm.note} onSave={(v) => set({ note: v })} />
      </label>
      <h3>Eingeladen</h3>
      {!locked && (
        <div style={{ marginBottom: 6 }}>
          <button className="btn small" onClick={() => set({ inviteeIds: protocol.attendees.filter((a) => a.present).map((a) => a.contactId) })}>
            = Teilnehmer dieser Besprechung
          </button>
        </div>
      )}
      {ids.map((id) => {
        const c = contactMap.get(id);
        if (!c) return null;
        return (
          <label key={id} className="check" style={{ display: 'flex' }}>
            <input
              type="checkbox"
              disabled={locked}
              checked={nm.inviteeIds.includes(id)}
              onChange={(e) => set({ inviteeIds: e.target.checked ? [...nm.inviteeIds, id] : nm.inviteeIds.filter((x) => x !== id) })}
            />
            {contactName(c)} <span className="muted small">{c.companyId && companyMap.get(c.companyId)?.name}</span>
          </label>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- Versand
function SendDialog({ d, protocol, typeName, onClose }: { d: D; protocol: Protocol; typeName: string; onClose: () => void }) {
  const settings = useSettings();
  const user = useUser();
  const { contactMap } = useGlobal();
  const vars = { projekt: d.project!.name, protokoll: `${typeName} Nr. ${protocol.code}`, datum: fmtDate(protocol.date), firma: settings.companyName, bezeichnung: protocol.title };
  const candidates = protocol.attendees.filter((a) => a.distribution).map((a) => contactMap.get(a.contactId)).filter((c) => c && c.email);
  const [to, setTo] = useState<string[]>(candidates.map((c) => c!.email!));
  const [extra, setExtra] = useState('');
  const [subject, setSubject] = useState(fillTemplate(settings.mailSubjectTemplate, vars));
  const [body, setBody] = useState(fillTemplate(settings.mailBodyTemplate, vars));
  const [closeIt, setCloseIt] = useState(protocol.status === 'entwurf');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true);
    setErr('');
    try {
      if (closeIt && protocol.status === 'entwurf')
        await save<Protocol>('protocol', protocol.id, { status: 'abgeschlossen', closedAt: new Date().toISOString(), closedBy: user.id, snapshot: protocol.mode === 'fortlaufend' ? makeSnapshot(protocol, d.itemMap) : null });
      await save<Protocol>('protocol', protocol.id, { sentAt: todayIso() });
      const { blob, filename } = await generateProtocolPdf(protocol.id);
      const b64 = (await blobToDataUrl(blob)).split(',')[1];
      const recipients = [...to, ...extra.split(/[,;\s]+/).filter((x) => x.includes('@'))];
      await api('/api/mail/send', { body: { to: recipients, subject, text: body, attachments: [{ filename, base64: b64 }] } });
      // versendetes PDF archivieren
      const fid = await addFile(new File([blob], filename, { type: 'application/pdf' }), protocol.projectId, filename);
      await save<Protocol>('protocol', protocol.id, { sentFileIds: [...(protocol.sentFileIds || []), fid] });
      alert(`Protokoll an ${recipients.length} Empfänger versendet.`);
      onClose();
    } catch (e: any) {
      setErr(e.status ? e.message : 'Keine Verbindung zum Server – der Versand ist nur online möglich.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Protokoll versenden"
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
      <h3>Empfänger (Verteiler)</h3>
      {!candidates.length && <div className="muted small">Kein Teilnehmer mit E-Mail-Adresse im Verteiler (Reiter „Teilnehmer & Verteiler“).</div>}
      <div className="grid2">
        {candidates.map((c) => (
          <label key={c!.id} className="check">
            <input type="checkbox" checked={to.includes(c!.email!)} onChange={(e) => setTo(e.target.checked ? [...to, c!.email!] : to.filter((x) => x !== c!.email))} />
            {contactName(c)} <span className="muted small">{c!.email}</span>
          </label>
        ))}
      </div>
      <label className="f" style={{ marginTop: 8 }}>
        Weitere Empfänger (durch Komma getrennt)
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
      {protocol.status === 'entwurf' && (
        <label className="check">
          <input type="checkbox" checked={closeIt} onChange={(e) => setCloseIt(e.target.checked)} /> Protokoll beim Versand abschließen
        </label>
      )}
      <div className="muted small">Die Empfänger werden im BCC adressiert; eine Kopie geht an das Büro-Postfach. Das versendete PDF wird im Projekt archiviert.</div>
    </Modal>
  );
}
