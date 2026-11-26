import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { extractPdf } from '../pdfextract';
import { importProtocol, ensureProtocolType, splitProjectTitle, type ImportResult } from '../importer';
import { useProjects, useSettings } from '../data';
import { save } from '../db';
import { SyncBadge, useUser } from '../App';
import { parseBaumaster, fmtDate, type BmProtocol, type Project } from '../../../shared/src/index';

interface Parsed {
  file: File;
  bm?: BmProtocol;
  error?: string;
  typeKey: string;
  result?: ImportResult;
}

export function ImportPage() {
  const user = useUser();
  const nav = useNavigate();
  const settings = useSettings();
  const { projects } = useProjects();
  const [list, setList] = useState<Parsed[]>([]);
  const [reading, setReading] = useState(false);
  const [target, setTarget] = useState<string>(''); // Projekt-ID oder "neu"
  const [newProj, setNewProj] = useState({ number: '', name: '', address: '', clientName: '', clientAddress: '' });
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setReading(true);
    setDone(null);
    const out: Parsed[] = [];
    for (const f of Array.from(files)) {
      try {
        const bm = parseBaumaster(await extractPdf(await f.arrayBuffer()));
        const t = settings.protocolTypes.find((x) => x.prefix.toUpperCase() === bm.prefix.toUpperCase());
        out.push({ file: f, bm, typeKey: t?.key || '' });
      } catch (e: any) {
        out.push({ file: f, error: 'PDF konnte nicht gelesen werden: ' + e.message, typeKey: '' });
      }
    }
    out.sort((a, b) => (a.bm?.date || '').localeCompare(b.bm?.date || ''));
    setList(out);
    // Projekt vorschlagen
    const firstBm = out.find((x) => x.bm)?.bm;
    if (firstBm) {
      const sp = splitProjectTitle(firstBm.projectTitle);
      const match = projects.find(
        (p) => (sp.number && p.number === sp.number) || p.name.toLowerCase() === sp.name.toLowerCase() || p.name.toLowerCase() === firstBm.projectTitle.toLowerCase(),
      );
      setTarget(match ? match.id : 'neu');
      setNewProj({ number: sp.number, name: sp.name, address: firstBm.projectAddress, clientName: firstBm.clientName, clientAddress: firstBm.clientAddress });
    }
    setReading(false);
  };

  const run = async () => {
    let pid = target;
    if (pid === 'neu') {
      if (!newProj.name) return alert('Bitte einen Projektnamen eingeben.');
      pid = await save<Project>('project', null, { ...newProj, archived: false, memberUserIds: [user.id], participants: [] });
    }
    const next = [...list];
    for (let k = 0; k < next.length; k++) {
      const p = next[k];
      if (!p.bm || p.result) continue;
      setBusy(`Importiere ${p.bm.code} (${k + 1}/${next.length}) …`);
      let typeKey = p.typeKey;
      if (!typeKey) typeKey = (await ensureProtocolType(p.bm)).key;
      try {
        p.result = await importProtocol(p.bm, pid, typeKey, p.file);
      } catch (e: any) {
        p.error = 'Import fehlgeschlagen: ' + e.message;
      }
      setList([...next]);
    }
    setBusy('');
    setDone(pid);
  };

  const ok = list.filter((x) => x.bm);
  return (
    <>
      <div className="topbar">
        <h1>Projektimport</h1>
        <div className="grow" />
      </div>
      <div className="card">
        <p style={{ marginTop: 0 }}>
          Wählen Sie ein oder mehrere Baumaster-Protokolle (PDF-Export) eines Projekts. Übernommen werden Kopfdaten, Beteiligte (Firmen und Kontakte), alle Punkte mit Feldern, Fälligkeit, Status und
          sämtlichen datierten Einträgen samt Formatierung. Das Original-PDF wird beim Protokoll abgelegt.
        </p>
        <p className="muted small">
          Tipp: Für laufende Projekte genügt das <b>letzte</b> Protokoll je Protokollart. Danach mit „Protokoll erstellen“ das nächste anlegen, die offenen Punkte werden übernommen. Fotos aus den PDFs werden
          nicht einzeln übernommen, sie bleiben im abgelegten Original-PDF erhalten. Die Häkchen „Vert./Teil.“ sind im PDF nur als Grafik enthalten: Alle Beteiligten werden in den Verteiler gesetzt.
        </p>
        <label className="btn primary">
          {reading ? 'Lese PDFs…' : 'Baumaster-PDFs auswählen'}
          <input type="file" accept="application/pdf" multiple hidden onChange={(e) => (read(e.target.files), (e.target.value = ''))} />
        </label>
      </div>

      {!!list.length && (
        <>
          <div className="tablewrap" style={{ marginBottom: 12 }}>
            <table className="list">
              <thead>
                <tr>
                  <th>Datei</th>
                  <th>Nr.</th>
                  <th>Bezeichnung</th>
                  <th>Datum</th>
                  <th className="c">Punkte</th>
                  <th className="c">offen</th>
                  <th className="c">Beteiligte</th>
                  <th>Protokollart</th>
                  <th>Ergebnis</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p, k) => (
                  <tr key={k}>
                    <td className="small">{p.file.name}</td>
                    {p.bm ? (
                      <>
                        <td>
                          <b>{p.bm.code}</b>
                        </td>
                        <td className="small">{p.bm.title}</td>
                        <td className="small">{fmtDate(p.bm.date)}</td>
                        <td className="c">{p.bm.items.length}</td>
                        <td className="c">{p.bm.items.filter((i) => i.status === 'offen').length}</td>
                        <td className="c">{p.bm.participants.length}</td>
                        <td>
                          <select
                            value={p.typeKey}
                            disabled={!!p.result}
                            onChange={(e) => setList(list.map((x, j) => (j === k ? { ...x, typeKey: e.target.value } : x)))}
                          >
                            <option value="">+ neu: {p.bm.typeName || p.bm.prefix} ({p.bm.prefix})</option>
                            {settings.protocolTypes.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.name} ({t.prefix})
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="small">
                          {p.result?.skipped && <span className="badge orange">{p.result.skipped}</span>}
                          {p.result && !p.result.skipped && (
                            <span className="badge green">
                              ✓ {p.result.createdItems} neu, {p.result.updatedItems} aktualisiert
                            </span>
                          )}
                          {p.bm.warnings.map((w) => (
                            <div key={w} className="badge orange">
                              {w}
                            </div>
                          ))}
                          {p.error && <span className="badge red">{p.error}</span>}
                        </td>
                      </>
                    ) : (
                      <td colSpan={8}>
                        <span className="badge red">{p.error}</span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!!ok.length && !done && (
            <div className="card">
              <h3 style={{ marginTop: 0 }}>Zielprojekt</h3>
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ maxWidth: 480 }}>
                <option value="neu">+ Neues Projekt anlegen</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number ? p.number + ' ' : ''}
                    {p.name}
                  </option>
                ))}
              </select>
              {target === 'neu' && (
                <div className="grid2" style={{ marginTop: 10 }}>
                  {(
                    [
                      ['number', 'Projektnummer'],
                      ['name', 'Projektbezeichnung'],
                      ['address', 'Projektadresse'],
                      ['clientName', 'Auftraggeber'],
                      ['clientAddress', 'Adresse Auftraggeber'],
                    ] as const
                  ).map(([k, l]) => (
                    <label key={k} className="f">
                      {l}
                      <input value={newProj[k]} onChange={(e) => setNewProj({ ...newProj, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <button className="btn primary" disabled={!!busy} onClick={run}>
                  {busy || `${ok.length} Protokoll${ok.length > 1 ? 'e' : ''} importieren`}
                </button>
              </div>
            </div>
          )}
          {done && (
            <div className="notice blue">
              Import abgeschlossen.{' '}
              <button className="btn small primary" onClick={() => nav('/p/' + done)}>
                Zum Projekt
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
