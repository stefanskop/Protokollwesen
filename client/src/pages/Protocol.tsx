import { useEffect, useMemo, useState } from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { save, remove } from '../db';
import { api } from '../api';
import { useProjectData, useGlobal, useSettings, addFile, blobToDataUrl, useFileUrl } from '../data';
import { generateProtocolPdf } from '../pdfgen';
import { Modal, LazyInput, LazyTextarea, DateInput } from '../components/ui';
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

/** alte Adresse → Arbeitsansicht */
export function ProtocolPage() {
  const { pid, prid } = useParams();
  const d = useProjectData(pid);
  const p = prid ? d.protocolMap.get(prid) : undefined;
  if (!d.loaded) return null;
  return <Navigate to={`/p/${pid}${p ? `?art=${p.typeKey}&p=${p.id}` : ''}`} replace />;
}

/** Punkte aus anderen Protokollen des Projekts in dieses Protokoll übernehmen */
export function AdoptDialog({ d, protocol, onClose }: { d: D; protocol: Protocol; onClose: () => void }) {
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
export function AttendeesTab({ d, protocol, locked }: { d: D; protocol: Protocol; locked: boolean }) {
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
export function HeadTab({ protocol, locked }: { protocol: Protocol; locked: boolean }) {
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
          <DateInput disabled={locked} value={protocol.date} onChange={(v) => v && set({ date: v })} />
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
      {(protocol.sourceFileId || !!protocol.sentFileIds?.length) && (
        <div style={{ marginBottom: 10 }}>
          <div className="f-label">Archiv</div>
          {protocol.sourceFileId && <FileLink id={protocol.sourceFileId} label="Original-PDF (Import)" />}
          {(protocol.sentFileIds || []).map((id, k) => (
            <FileLink key={id} id={id} label={`Versendetes PDF ${k + 1}`} />
          ))}
        </div>
      )}
      <label className="check">
        <input type="checkbox" disabled={locked} checked={protocol.mode === 'fortlaufend'} onChange={(e) => set({ mode: e.target.checked ? 'fortlaufend' : 'standard' })} />
        Fortlaufendes Protokoll (nach Abschluss gesperrt)
      </label>
    </div>
  );
}

// ---------------------------------------------------------------- Nächste Besprechung
export function NextMeetingTab({ d, protocol, locked }: { d: D; protocol: Protocol; locked: boolean }) {
  const { contactMap, companyMap } = useGlobal();
  const nm = protocol.nextMeeting || { date: '', timeFrom: protocol.timeFrom, timeTo: protocol.timeTo, location: protocol.location, note: '', inviteeIds: [] };
  const set = (patch: Partial<NonNullable<Protocol['nextMeeting']>>) => save<Protocol>('protocol', protocol.id, { nextMeeting: { ...nm, ...patch } });
  const ids = d.project!.participants.map((p) => p.contactId);
  return (
    <div className="card">
      <div className="grid3">
        <label className="f">
          Datum
          <DateInput disabled={locked} value={nm.date} onChange={(v) => set({ date: v || '' })} />
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
export function SendDialog({ d, protocol, typeName, onClose }: { d: D; protocol: Protocol; typeName: string; onClose: () => void }) {
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

function FileLink({ id, label }: { id: string; label: string }) {
  const url = useFileUrl(id);
  return (
    <a className="btn small" style={{ marginRight: 6 }} href={url} target="_blank" rel="noreferrer">
      📄 {label}
    </a>
  );
}
