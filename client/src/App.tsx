import { useEffect, useState, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import type { UserInfo } from '../../shared/src/index';
import { api, getStoredUser, storeLogin, clearLogin, getToken } from './api';
import { openUserDb, ldb, setMeta } from './db';
import { startSyncLoop, onSyncState, syncNow, type SyncState } from './sync';
import { ProjectsPage } from './pages/Projects';
import { ProjectPage } from './pages/Project';
import { ProtocolPage } from './pages/Protocol';
import { Workspace } from './pages/Workspace';
import { ImportPage } from './pages/Import';
import { PlansPage } from './pages/Plans';
import { DefectsPage } from './pages/Defects';
import { KostenPage } from './pages/Kosten';
import { useProjects } from './data';
import { Header } from './components/Header';


/** Öffnet einen Projektbereich im zuletzt verwendeten Projekt */
function LastProject({ to }: { to: string }) {
  const { projects, loaded } = useProjects();
  if (!loaded) return null;
  let last: string | null = null;
  try {
    last = localStorage.getItem('pw.lastProject');
  } catch {}
  const p = projects.find((x) => x.id === last && !x.archived) || projects.find((x) => !x.archived);
  if (!p) return <div className="empty">Noch keine Projekte vorhanden.</div>;
  return <Navigate to={`/p/${p.id}/${to}`} replace />;
}

export function rememberProject(id: string) {
  try {
    localStorage.setItem('pw.lastProject', id);
  } catch {}
}
import { ContactsPage } from './pages/Contacts';
import { SettingsPage } from './pages/Settings';

const UserCtx = createContext<UserInfo | null>(null);
export const useUser = () => useContext(UserCtx)!;

export function App() {
  const [user, setUser] = useState<UserInfo | null>(() => {
    const u = getStoredUser();
    if (u && getToken()) openUserDb(u.id);
    return u && getToken() ? u : null;
  });

  useEffect(() => {
    if (!user) return;
    startSyncLoop();
    // Benutzerdaten auffrischen (z.B. Rollenänderung)
    api<{ user: UserInfo }>('/api/me')
      .then((r) => {
        storeLogin(getToken()!, r.user);
        setUser(r.user);
      })
      .catch(() => {});
    const onUnauth = () => {
      clearLogin();
      setUser(null);
    };
    window.addEventListener('pw-unauthorized', onUnauth);
    return () => window.removeEventListener('pw-unauthorized', onUnauth);
  }, [user?.id]);

  if (!user)
    return (
      <Login
        onLogin={(u) => {
          openUserDb(u.id);
          setUser(u);
        }}
      />
    );

  return (
    <UserCtx.Provider value={user}>
      <BrowserRouter>
        <div className="app2">
          <Header />
          <Main>
            <Notices />
            <Routes>
              <Route path="/" element={<ProjectsPage />} />
              <Route path="/p/:pid" element={<Workspace />} />
              <Route path="/p/:pid/projekt" element={<ProjectPage />} />
              <Route path="/p/:pid/plaene" element={<PlansPage />} />
              <Route path="/p/:pid/protokoll/:prid" element={<ProtocolPage />} />
              <Route path="/kontakte" element={<ContactsPage />} />
              <Route path="/plaene" element={<LastProject to="plaene" />} />
              <Route path="/maengel" element={<LastProject to="maengel" />} />
              <Route path="/p/:pid/maengel" element={<DefectsPage />} />
              <Route path="/p/:pid/kosten" element={<KostenPage />} />
              <Route
                path="/p/:pid/einstellungen"
                element={
                  <SettingsPage
                    onLogout={async () => {
                      try {
                        await api('/api/logout', { method: 'POST' });
                      } catch {}
                      clearLogin();
                      setUser(null);
                    }}
                  />
                }
              />
              <Route path="/import" element={<ImportPage />} />
              <Route
                path="/einstellungen"
                element={
                  <SettingsPage
                    onLogout={async () => {
                      try {
                        await api('/api/logout', { method: 'POST' });
                      } catch {}
                      clearLogin();
                      setUser(null);
                    }}
                  />
                }
              />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Main>
        </div>
      </BrowserRouter>
    </UserCtx.Provider>
  );
}

function Main({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  return <main className={'main' + (/^\/p\/[^/]+(\/plaene|\/maengel|\/kosten)?\/?$/.test(loc.pathname) ? ' main-ws' : '')}>{children}</main>;
}

export function SyncBadge() {
  const [s, setS] = useState<SyncState>({ status: 'idle', pending: 0 });
  useEffect(() => {
    const off = onSyncState(setS);
    return () => {
      off();
    };
  }, []);
  const label =
    s.status === 'syncing'
      ? 'Synchronisiere…'
      : s.status === 'offline'
        ? `Offline${s.pending ? ` · ${s.pending} Änderungen ausstehend` : ''}`
        : s.status === 'error'
          ? 'Sync-Fehler'
          : s.pending
            ? `${s.pending} ausstehend`
            : 'Synchronisiert';
  return (
    <button className={'sync ' + s.status} title={s.message || (s.lastSync ? 'Letzter Abgleich: ' + new Date(s.lastSync).toLocaleString('de-AT') : '')} onClick={() => syncNow()}>
      ⟳ {label}
    </button>
  );
}

function Notices() {
  const n = useLiveQuery(() => ldb.meta.get('notices'), []);
  const list: { ts: string; msg: string }[] = n?.value || [];
  if (!list.length) return null;
  return (
    <div className="notice">
      {list.slice(-5).map((x, i) => (
        <div key={i}>
          {new Date(x.ts).toLocaleString('de-AT')}: {x.msg}
        </div>
      ))}
      <button className="btn small" style={{ marginTop: 6 }} onClick={() => setMeta('notices', [])}>
        Gelesen
      </button>
    </div>
  );
}

function Login({ onLogin }: { onLogin: (u: UserInfo) => void }) {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const device = /iPad|iPhone/.test(navigator.userAgent) ? 'iPad/iPhone' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows-PC' : 'Browser';
      const r = await api<{ token: string; user: UserInfo }>('/api/login', { body: { email, password: pw, device } });
      storeLogin(r.token, r.user);
      onLogin(r.user);
    } catch (e: any) {
      setErr(e.status ? e.message : 'Server nicht erreichbar – für die erste Anmeldung ist eine Verbindung nötig.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login-bg">
    <form className="login" onSubmit={submit}>
      <img src="/logo.png" alt="Skop Bauconsulting" />
      <h1>Projektmanagement</h1>
      <p className="muted small">Protokolle · Pläne · Mängel · Kosten – bitte melden Sie sich an.</p>
      {err && <div className="notice red">{err}</div>}
      <label className="f">
        E-Mail
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="f">
        Passwort
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
      </label>
      <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
        Anmelden
      </button>
    </form>
    </div>
  );
}
