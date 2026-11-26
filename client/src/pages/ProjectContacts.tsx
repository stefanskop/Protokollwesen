// Reiter „01 Kontakte“: Firmen & Kontakte dem Projekt zuordnen (Schieberegler), Projektbeteiligtenliste exportieren
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { save } from '../db';
import { useGlobal, useProjectData, useSettings } from '../data';
import { rememberProject } from '../App';
import { CompanyForm, ContactForm } from './Contacts';
import { LazyInput } from '../components/ui';
import { loadPdfMake, defaultLogo, imageDataUrl } from '../pdfgen';
import { contactName, fmtDate, todayIso, type Company, type Contact, type Project } from '../../../shared/src/index';

const letterOf = (s: string) => {
  const c = s.trim().charAt(0).toUpperCase();
  return /[A-ZÄÖÜ]/.test(c) ? c.replace('Ä', 'A').replace('Ö', 'O').replace('Ü', 'U') : '#';
};

function Toggle({ on, onChange, title }: { on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button type="button" className={'tgl' + (on ? ' on' : '')} title={title} onClick={(e) => (e.stopPropagation(), onChange(!on))}>
      <span />
    </button>
  );
}

export function ProjectContactsPage() {
  const { pid } = useParams();
  const d = useProjectData(pid);
  const { companies, contacts, companyMap } = useGlobal();
  const settings = useSettings();
  const [filter, setFilter] = useState<'alle' | 'projekt'>('alle');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [editCompany, setEditCompany] = useState<Partial<Company> | null>(null);
  const [editContact, setEditContact] = useState<Partial<Contact> | null>(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    if (pid) rememberProject(pid);
  }, [pid]);

  const project = d.project;
  const part = useMemo(() => new Map((project?.participants || []).map((p) => [p.contactId, p])), [project]);
  if (!d.loaded) return null;
  if (!project) return <div className="empty">Projekt nicht gefunden.</div>;

  const byCompany = new Map<string, Contact[]>();
  for (const c of contacts) {
    const k = c.companyId || '_';
    if (!byCompany.has(k)) byCompany.set(k, []);
    byCompany.get(k)!.push(c);
  }
  const inProject = (cid: string) => (byCompany.get(cid) || []).some((c) => part.has(c.id));
  const ql = q.toLowerCase();
  const matches = (co: Company | null) => {
    if (!q) return true;
    const cs = byCompany.get(co ? co.id : '_') || [];
    return (co && `${co.name} ${co.trade || ''}`.toLowerCase().includes(ql)) || cs.some((c) => `${contactName(c)} ${c.email} ${c.function}`.toLowerCase().includes(ql));
  };
  const own = companies.find((c) => c.name.trim().toLowerCase() === settings.companyName.trim().toLowerCase());
  const list = companies.filter((c) => c.id !== own?.id).filter((c) => (filter === 'projekt' ? inProject(c.id) : true)).filter(matches);
  const groups = new Map<string, Company[]>();
  for (const c of list) {
    const l = letterOf(c.name);
    if (!groups.has(l)) groups.set(l, []);
    groups.get(l)!.push(c);
  }
  const noCompany = (byCompany.get('_') || []).filter((c) => filter === 'alle' || part.has(c.id));

  const setParticipants = (participants: Project['participants']) => save<Project>('project', project.id, { participants });
  const toggleContact = (c: Contact, on: boolean) => {
    const co = c.companyId ? companyMap.get(c.companyId) : undefined;
    if (on) setParticipants([...project.participants, { contactId: c.id, role: c.function || co?.trade || '', defaultDistribution: true }]);
    else setParticipants(project.participants.filter((p) => p.contactId !== c.id));
  };
  const toggleCompany = (co: Company, on: boolean) => {
    const cs = byCompany.get(co.id) || [];
    if (on) {
      if (!cs.length) {
        setEditContact({ companyId: co.id, function: co.trade || '' });
        return;
      }
      const add = cs.filter((c) => !part.has(c.id)).map((c) => ({ contactId: c.id, role: c.function || co.trade || '', defaultDistribution: true }));
      setParticipants([...project.participants, ...add]);
      setOpen({ ...open, [co.id]: true });
    } else {
      const n = cs.filter((c) => part.has(c.id)).length;
      if (n > 1 && !confirm(`Alle ${n} Kontakte von „${co.name}“ aus dem Projekt entfernen?`)) return;
      const ids = new Set(cs.map((c) => c.id));
      setParticipants(project.participants.filter((p) => !ids.has(p.contactId)));
    }
  };
  const trades = (co: Company) => {
    const roles = (byCompany.get(co.id) || []).map((c) => part.get(c.id)?.role).filter(Boolean) as string[];
    return [...new Set(roles.length ? roles : [co.trade].filter(Boolean) as string[])].join(', ');
  };

  // ---------- Projektbeteiligtenliste ----------
  const participantRows = () =>
    project.participants
      .map((p) => ({ p, c: contacts.find((x) => x.id === p.contactId) }))
      .filter((r) => r.c)
      .map((r) => ({ ...r, co: r.c!.companyId ? companyMap.get(r.c!.companyId) : undefined }))
      .sort((a, b) => (a.co?.name || '').localeCompare(b.co?.name || '', 'de') || a.c!.lastName.localeCompare(b.c!.lastName, 'de'));
  const fileBase = `${(project.number ? project.number + '_' : '') + project.name}`.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_') + '_Projektbeteiligte';

  const exportXlsx = async () => {
    setBusy('XLSX…');
    try {
      const writeXlsxFile = (await import('write-excel-file')).default as any;
      const head = ['Firma', 'Titel', 'Vorname', 'Nachname', 'Gewerk / Funktion', 'Telefon', 'E-Mail', 'Verteiler'].map((v) => ({ value: v, fontWeight: 'bold', backgroundColor: '#E1EBF5' }));
      const data = [
        [{ value: `Projektbeteiligte – ${project.number ? project.number + ' ' : ''}${project.name}`, fontWeight: 'bold', fontSize: 14 }],
        [{ value: `Stand ${fmtDate(todayIso())}` }],
        [],
        head,
        ...participantRows().map(({ p, c, co }) => [
          { value: co?.name || '' },
          { value: c!.title || '' },
          { value: c!.firstName || '' },
          { value: c!.lastName || '' },
          { value: p.role || '' },
          { value: c!.phone || '' },
          { value: c!.email || '' },
          { value: p.defaultDistribution ? 'ja' : '' },
        ]),
      ];
      await writeXlsxFile(data, { columns: [{ width: 36 }, { width: 10 }, { width: 16 }, { width: 20 }, { width: 26 }, { width: 18 }, { width: 34 }, { width: 10 }], fileName: fileBase + '.xlsx' });
    } finally {
      setBusy('');
    }
  };

  const exportPdf = async () => {
    setBusy('PDF…');
    const w = window.open('', '_blank');
    try {
      const rows = participantRows();
      const body: any[] = [['Name', 'Gewerk / Funktion', 'Telefon', 'E-Mail'].map((t) => ({ text: t, bold: true, fontSize: 8.5, fillColor: '#e1ebf5' }))];
      let lastCo = '';
      for (const { p, c, co } of rows) {
        const cn = co?.name || 'Ohne Firma';
        if (cn !== lastCo) {
          body.push([{ text: cn, bold: true, fontSize: 9.5, colSpan: 4, margin: [0, 4, 0, 0] }, '', '', '']);
          lastCo = cn;
        }
        body.push([
          { text: [c!.title, contactName(c)].filter(Boolean).join(' '), fontSize: 8.5, margin: [8, 0, 0, 0] },
          { text: p.role || '', fontSize: 8.5 },
          { text: c!.phone || '', fontSize: 8.5 },
          { text: c!.email || '', fontSize: 8.5, color: '#1a4f82' },
        ]);
      }
      const logo = settings.logoFileId ? await imageDataUrl(settings.logoFileId) : await defaultLogo();
      const doc = {
        pageSize: 'A4',
        pageOrientation: 'portrait',
        pageMargins: [40, 70, 40, 46],
        defaultStyle: { font: 'Roboto', fontSize: 9 },
        header: { columns: [{ text: [settings.companyName, settings.companyAddress].filter(Boolean).join(' - '), fontSize: 7.5, margin: [40, 34, 0, 0] }, logo ? { image: logo, fit: [120, 34], alignment: 'right', margin: [0, 18, 40, 0] } : ''] },
        footer: (page: number, pages: number) => ({ columns: [{ text: `Stand ${fmtDate(todayIso())}`, fontSize: 7.5, color: '#6b6b6b' }, { text: `Seite ${page}/${pages}`, alignment: 'right', fontSize: 8 }], margin: [40, 14, 40, 0] }),
        content: [
          { text: project.name, fontSize: 15, color: '#6b6b6b' },
          { text: project.address || '', fontSize: 9, margin: [0, 0, 0, 6] },
          { text: 'Projektbeteiligtenliste', fontSize: 18, bold: true, color: '#555', margin: [0, 0, 0, 10] },
          {
            table: { headerRows: 1, widths: [150, 120, 85, '*'], body, dontBreakRows: true },
            layout: { hLineWidth: (i: number) => (i <= 1 ? 0 : 0.5), vLineWidth: () => 0, hLineColor: () => '#bdbdbd', paddingTop: () => 3, paddingBottom: () => 3 },
          },
        ],
      };
      const pdfMake = await loadPdfMake();
      const blob: Blob = await new Promise((res) => pdfMake.createPdf(doc).getBlob((b: Blob) => res(b)));
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

  const companyRow = (co: Company, mine = false) => {
    const cs = (byCompany.get(co.id) || []).filter((c) => filter === 'alle' || part.has(c.id)).sort((a, b) => a.lastName.localeCompare(b.lastName, 'de'));
    const isOpen = open[co.id] ?? (!!q && cs.some((c) => `${contactName(c)} ${c.email}`.toLowerCase().includes(ql)));
    const on = inProject(co.id);
    return (
      <div key={co.id} className={'kc-company' + (on ? ' on' : '') + (mine ? ' mine' : '')}>
        <div className="kc-row" onClick={() => setOpen({ ...open, [co.id]: !isOpen })}>
          <Toggle on={on} onChange={(v) => toggleCompany(co, v)} title={on ? 'aus dem Projekt entfernen' : 'zum Projekt hinzufügen'} />
          <i className={'fa-solid ' + (isOpen ? 'fa-caret-down' : 'fa-caret-right') + ' kc-caret'} />
          <span className="kc-name">
            {co.name} <span className="kc-cnt">{(byCompany.get(co.id) || []).length}</span>
          </span>
          <span className="kc-trade">{trades(co)}</span>
          <button className="btn small ghost" title="Firma bearbeiten" onClick={(e) => (e.stopPropagation(), setEditCompany(co))}>
            <i className="fa-solid fa-pen" />
          </button>
        </div>
        {isOpen && (
          <div className="kc-contacts">
            {cs.map((c) => {
              const p = part.get(c.id);
              return (
                <div key={c.id} className={'kc-contact' + (p ? ' on' : '')}>
                  <Toggle on={!!p} onChange={(v) => toggleContact(c, v)} />
                  <span className="kc-cname">{[c.title, contactName(c)].filter(Boolean).join(' ')}</span>
                  {p ? (
                    <LazyInput
                      className="kc-role"
                      value={p.role}
                      placeholder="Gewerk / Funktion im Projekt"
                      onSave={(v) => setParticipants(project.participants.map((x) => (x.contactId === c.id ? { ...x, role: v } : x)))}
                    />
                  ) : (
                    <span className="kc-role muted small">{c.function}</span>
                  )}
                  <span className="small">{c.phone}</span>
                  <span className="small kc-mail">{c.email}</span>
                  {p ? (
                    <label className="check small" style={{ margin: 0 }} title="standardmäßig im Verteiler neuer Protokolle">
                      <input
                        type="checkbox"
                        checked={p.defaultDistribution}
                        onChange={(e) => setParticipants(project.participants.map((x) => (x.contactId === c.id ? { ...x, defaultDistribution: e.target.checked } : x)))}
                      />{' '}
                      Verteiler
                    </label>
                  ) : (
                    <span />
                  )}
                  <button className="btn small ghost" title="Kontakt bearbeiten" onClick={() => setEditContact(c)}>
                    <i className="fa-solid fa-pen" />
                  </button>
                </div>
              );
            })}
            <button className="btn small" style={{ margin: '4px 0 4px 54px' }} onClick={() => setEditContact({ companyId: co.id, function: co.trade || '' })}>
              <i className="fa-solid fa-user-plus" /> Kontakt hinzufügen
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="card sec-card">
        <div className="row" style={{ alignItems: 'center' }}>
          <div className="sec-h" style={{ border: 'none', margin: 0, padding: 0, flex: '1 1 auto' }}>
            <i className="fa-solid fa-address-book" /> 01 Kontakte &amp; Projektbeteiligte
            <span className="badge blue">{project.participants.length} im Projekt</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flex: '0 0 auto', flexWrap: 'wrap' }}>
            <button className="btn red" onClick={exportPdf} disabled={!!busy || !project.participants.length}>
              <i className="fa-solid fa-file-pdf" /> Beteiligtenliste PDF
            </button>
            <button className="btn green" onClick={exportXlsx} disabled={!!busy || !project.participants.length}>
              <i className="fa-solid fa-file-excel" /> XLSX
            </button>
            <button className="btn" onClick={() => setEditContact({})}>
              <i className="fa-solid fa-user-plus" /> Kontakt
            </button>
            <button className="btn primary" onClick={() => setEditCompany({})}>
              <i className="fa-solid fa-plus" /> Neue Firma
            </button>
          </div>
        </div>
        <div className="muted small" style={{ marginTop: 6 }}>
          Mit dem Schieberegler Firmen bzw. einzelne Kontakte dem Projekt zuordnen. Die Projektbeteiligten erscheinen auf der Titelseite jedes Protokolls (Beteiligtenliste) und können als Verteiler gewählt
          werden. Firmen und Kontakte gelten für alle Projekte und für die Kostenverfolgung.
        </div>
      </div>
      <div className="kc-bar">
        <div className="kc-seg">
          <button className={filter === 'alle' ? 'on' : ''} onClick={() => setFilter('alle')}>
            Alle Firmen
          </button>
          <button className={filter === 'projekt' ? 'on' : ''} onClick={() => setFilter('projekt')}>
            Projektteam
          </button>
        </div>
        <span className="search-in">
          <i className="fa-solid fa-magnifying-glass" />
          <input placeholder="Suche nach Firma, Name, Gewerk, E-Mail …" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
        <button className="btn small" onClick={() => setOpen(Object.fromEntries(list.map((c) => [c.id, true])))}>
          alle aufklappen
        </button>
        <button className="btn small" onClick={() => setOpen({})}>
          zuklappen
        </button>
      </div>
      <div className="kc-list">
        {own && (filter === 'alle' || inProject(own.id)) && matches(own) && (
          <>
            <div className="kc-letter">Meine Firma</div>
            {companyRow(own, true)}
          </>
        )}
        {[...groups.entries()]
          .sort((a, b) => (a[0] === '#' ? -1 : b[0] === '#' ? 1 : a[0].localeCompare(b[0])))
          .map(([l, cs]) => (
            <div key={l}>
              <div className="kc-letter">{l}</div>
              {cs.map((c) => companyRow(c))}
            </div>
          ))}
        {!!noCompany.length && (
          <div>
            <div className="kc-letter">Ohne Firma</div>
            <div className="kc-company">
              <div className="kc-contacts">
                {noCompany.map((c) => (
                  <div key={c.id} className={'kc-contact' + (part.has(c.id) ? ' on' : '')}>
                    <Toggle on={part.has(c.id)} onChange={(v) => toggleContact(c, v)} />
                    <span className="kc-cname">{contactName(c)}</span>
                    <span className="kc-role muted small">{c.function}</span>
                    <span className="small">{c.phone}</span>
                    <span className="small kc-mail">{c.email}</span>
                    <span />
                    <button className="btn small ghost" onClick={() => setEditContact(c)}>
                      <i className="fa-solid fa-pen" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {!list.length && !own && <div className="empty">{filter === 'projekt' ? 'Noch keine Firmen im Projekt – unter „Alle Firmen“ per Schieberegler hinzufügen.' : 'Keine Firmen gefunden.'}</div>}
      </div>
      {editCompany && <CompanyForm value={editCompany} onClose={() => setEditCompany(null)} />}
      {editContact && (
        <ContactForm
          value={editContact}
          onClose={() => setEditContact(null)}
          onSaved={(id) => {
            // neu angelegte Kontakte gleich dem Projekt zuordnen
            if (!editContact.id && !part.has(id)) {
              const co = editContact.companyId ? companyMap.get(editContact.companyId) : undefined;
              setParticipants([...project.participants, { contactId: id, role: editContact.function || co?.trade || '', defaultDistribution: true }]);
            }
          }}
        />
      )}
    </>
  );
}
