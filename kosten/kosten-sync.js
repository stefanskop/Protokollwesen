/*
 * Kostenverfolgung Hochbau – Anbindung an den Protokollwesen-Server (NAS)
 *
 * Wird beim Bauen automatisch am Ende von Kostenverfolgung.html eingebunden.
 * Die Kostenverfolgung selbst bleibt unverändert: Sie arbeitet weiter mit dem
 * Browserspeicher. Dieses Skript gleicht diesen Speicher mit dem Server ab:
 *
 *  - Anmeldung wie im Protokollwesen (gleiches Konto, gleiche Anmeldung im Browser)
 *  - Beim Start werden die Projekte vom Server geladen
 *  - Jede Änderung wird nach wenigen Sekunden auf den Server übertragen
 *  - Ohne Verbindung wird lokal weitergearbeitet und später übertragen
 *  - Wurde dasselbe Projekt auf zwei Geräten geändert, entscheidet der Benutzer
 *  - Originalrechnungen (PDF) der Rechnungsprüfung werden mit übertragen
 */
(function () {
  'use strict';
  if (typeof boot !== 'function' || typeof loadStore !== 'function') return;

  const LS_TOKEN = 'pw.token';
  const LS_USER = 'pw.user';
  const LS_STATE = 'KVT_SYNC_V1';
  const PUSH_DELAY = 2500;
  const POLL_MS = 30000;

  /* ---------------- Hilfen ---------------- */
  const h = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } },
  };
  /** Prüfsumme eines Stands (erkennt lokale Änderungen ohne Kopie im Speicher) */
  function hash(obj) {
    const s = JSON.stringify(obj) || '';
    let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 0x01000193);
      b = Math.imul(b ^ c, 0x5bd1e995);
    }
    return s.length.toString(36) + '.' + (a >>> 0).toString(36) + '.' + (b >>> 0).toString(36);
  }
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso || ''; } };
  const nowStr = () => new Date().toLocaleString('de-AT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const pname = (p) => p ? `${(p.meta && p.meta.projNr) || ''} ${(p.meta && p.meta.projekt) || ''}`.trim() || 'Projekt' : 'Projekt';
  const say = (m, ms) => { try { toast(m, ms); } catch (e) { } };

  class ApiError extends Error { constructor(status, msg, body) { super(msg); this.status = status; this.body = body; } }

  async function api(path, opts) {
    opts = opts || {};
    const headers = {};
    const t = ls.get(LS_TOKEN);
    if (t) headers.Authorization = 'Bearer ' + t;
    let body;
    if (opts.raw !== undefined) { body = opts.raw; headers['Content-Type'] = 'application/octet-stream'; }
    else if (opts.body !== undefined) { body = JSON.stringify(opts.body); headers['Content-Type'] = 'application/json'; }
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), opts.timeout || 60000);
    let res;
    try { res = await fetch(path, { method: opts.method || (body !== undefined ? 'POST' : 'GET'), headers, body, signal: ctl.signal, cache: 'no-store' }); }
    finally { clearTimeout(to); }
    if (!res.ok) {
      let j = null; try { j = await res.json(); } catch (e) { }
      if (res.status === 401 && t && !opts.login) KS.unauthorized();
      throw new ApiError(res.status, (j && j.error) || res.statusText, j);
    }
    const ct = res.headers.get('content-type') || '';
    return ct.includes('application/json') ? res.json() : res.blob();
  }

  /* ---------------- Zustand ---------------- */
  const KS = {
    user: null,            // angemeldeter Benutzer {id, name, role, email}
    online: false,
    status: 'start',       // start | ok | busy | offline | login | conflict | error
    lastSync: null,
    lastError: '',
    st: null,              // { user, docs:{id:{rev,hash}}, localOnly:{id:1}, files:{id:1} }
    server: {},            // letzte Übersicht vom Server {id: summary}
    pre: null,             // beim Start geladene Stände
    conflicts: [],         // offene Konflikte
    skip: {},              // Projekte mit offenem Konflikt (nicht übertragen)
    running: false, again: false, _t: null, booted: false,
    users: null,
  };
  window.KS = KS;

  KS.loadState = function () {
    let s = null; try { s = JSON.parse(ls.get(LS_STATE) || 'null'); } catch (e) { }
    s = s || {}; s.docs = s.docs || {}; s.localOnly = s.localOnly || {}; s.files = s.files || {};
    KS.st = s;
  };
  KS.saveState = function () { ls.set(LS_STATE, JSON.stringify(KS.st)); };
  KS.storedUser = function () { try { return JSON.parse(ls.get(LS_USER) || 'null'); } catch (e) { return null; } };

  /* ---------------- Start: Server-Stände vor dem Programmstart laden ---------------- */
  document.removeEventListener('DOMContentLoaded', boot);
  const origLoadStore = loadStore;
  let storeWasEmpty = false;

  window.loadStore = function () {
    const s = origLoadStore();
    // anderer Benutzer als zuletzt in diesem Browser: dessen Server-Projekte nicht weiterführen
    if (KS.user && KS.st.user && KS.st.user !== KS.user.id) {
      Object.keys(KS.st.docs).forEach((id) => { if (id !== 'buero') delete s.projects[id]; });
      KS.st = { user: KS.user.id, docs: {}, localOnly: {}, files: {} };
    }
    if (KS.user) KS.st.user = KS.user.id;
    if (KS.pre) {
      Object.values(KS.pre.items).forEach((it) => {
        const st = KS.st.docs[it.id];
        if (it.kind === 'buero') {
          const lh = hash(s.buero);
          if (!it.deleted && it.data && (!st || it.rev > st.rev) && (!st || lh === st.hash)) {
            s.buero = Object.assign(defaultBuero(), it.data);
            KS.st.docs.buero = { rev: it.rev, hash: hash(s.buero) };
          }
          return;
        }
        const local = s.projects[it.id];
        const unchanged = local && st && hash(local) === st.hash;
        if (it.deleted) {
          if (local && unchanged) delete s.projects[it.id];
          if (!local || unchanged) delete KS.st.docs[it.id];
          return;
        }
        if (st && it.rev <= st.rev) return;
        if (!it.data) return;
        if (!local || unchanged) {
          const p = normalizeProject(it.data);
          s.projects[it.id] = p;
          s.dirty[it.id] = 0;
          s.lastSave[it.id] = 'NAS ' + fmtTime(it.updatedAt);
          KS.st.docs[it.id] = { rev: it.rev, hash: hash(p) };
        } else {
          KS.conflicts.push({ id: it.id, server: it });
          KS.skip[it.id] = true;
        }
      });
    }
    if (KS.user) {
      s.user = KS.user.name;
      s.users = Array.isArray(s.users) ? s.users : [];
      if (!s.users.includes(KS.user.name)) s.users.push(KS.user.name);
    }
    storeWasEmpty = !Object.keys(s.projects).length;
    KS.saveState();
    return s;
  };

  async function preload() {
    KS.loadState();
    const token = ls.get(LS_TOKEN);
    KS.user = KS.storedUser();
    if (!token) { KS.showLogin(); return false; }
    try {
      const me = await api('/api/me', { timeout: 8000 });
      KS.user = me.user; ls.set(LS_USER, JSON.stringify(me.user));
      if (KS.st.user && KS.st.user !== KS.user.id) { /* wird in loadStore bereinigt */ }
      const list = await api('/api/kosten/list', { timeout: 15000 });
      const items = {};
      const need = [];
      list.items.forEach((it) => {
        KS.server[it.id] = it; items[it.id] = it;
        const st = KS.st.user === KS.user.id ? KS.st.docs[it.id] : null;
        if (!it.deleted && (!st || it.rev > st.rev)) need.push(it);
      });
      for (const it of need) {
        try { const d = await api('/api/kosten/doc/' + encodeURIComponent(it.id), { timeout: 120000 }); it.data = d.data; it.rev = d.rev; } catch (e) { console.warn('[Kosten-Sync] Laden fehlgeschlagen', it.id, e); }
      }
      KS.pre = { items };
      KS.online = true; KS.status = 'ok'; KS.lastSync = new Date();
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return false;
      console.warn('[Kosten-Sync] Server nicht erreichbar – Start mit lokalem Stand', e);
      KS.online = false; KS.status = 'offline';
      return true;
    }
  }

  function start() {
    preload().then((go) => {
      if (go === false && KS.status === 'login') return;
      runBoot();
    });
  }

  function runBoot() {
    if (KS.booted) return;
    KS.booted = true;
    boot();
    // Beispielprojekt beim allerersten Start nicht auf den Server übertragen
    if (storeWasEmpty) Object.keys(STORE.projects).forEach((id) => { if (!KS.st.docs[id]) KS.st.localOnly[id] = 1; });
    KS.saveState();
    hookApp();
    KS.renderPill();
    if (START.isOpen) START.render();
    setInterval(() => KS.sync(), POLL_MS);
    window.addEventListener('online', () => KS.sync());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') KS.sync(); });
    window.addEventListener('beforeunload', (e) => {
      if (ls.get(LS_TOKEN) && KS.status !== 'offline' && KS.status !== 'login' && KS.pendingCount() > 0) { e.preventDefault(); e.returnValue = ''; }
    });
    setTimeout(() => { KS.nextConflict(); KS.sync(); }, 600);
  }

  // Offline-Betrieb: gleicher Service Worker wie das Protokollwesen (hält auch diese Seite vor)
  try { if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => { }); } catch (e) { }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  /* ---------------- Programm-Funktionen ergänzen ---------------- */
  function hookApp() {
    const origPersist = window.persist;
    window.persist = function () { const r = origPersist.apply(this, arguments); KS.soon(); return r; };
    const origDemo = PRJ.demo;
    PRJ.demo = function () { const r = origDemo.apply(PRJ, arguments); if (P) { KS.st.localOnly[P.id] = 1; KS.saveState(); KS.renderPill(); } return r; };
    // Startseite: Hinweis auf Server-Ablage
    const origRender = START.render;
    START.render = function () {
      origRender.apply(START, arguments);
      const box = document.querySelector('#start .st-box');
      if (box && !box.querySelector('.ks-note')) {
        const d = document.createElement('div');
        d.className = 'ks-note';
        d.innerHTML = KS.user
          ? `Angemeldet als <b>${h(KS.user.name)}</b> · Projekte werden automatisch auf dem Server (NAS) gespeichert und auf allen Geräten abgeglichen. <a href="/">← zum Protokollwesen</a>`
          : 'Nicht angemeldet – Projekte liegen nur in diesem Browser.';
        box.appendChild(d);
      }
    };
  }

  KS.soon = function () {
    clearTimeout(KS._t);
    KS._t = setTimeout(() => KS.sync(), PUSH_DELAY);
    KS.renderPill();
  };

  KS.pendingCount = function () {
    if (typeof STORE === 'undefined' || !STORE || !KS.st) return 0;
    let n = 0;
    Object.keys(STORE.projects).forEach((id) => {
      if (KS.st.localOnly[id]) return;
      const st = KS.st.docs[id];
      if (!st || hash(STORE.projects[id]) !== st.hash) n++;
    });
    Object.keys(KS.st.docs).forEach((id) => { if (id !== 'buero' && !STORE.projects[id]) n++; });
    const b = KS.st.docs.buero;
    if (!b || hash(STORE.buero) !== b.hash) n++;
    return n;
  };

  /* ---------------- Abgleich ---------------- */
  KS.sync = async function () {
    if (!KS.booted || !KS.user || !ls.get(LS_TOKEN)) return;
    if (KS.running) { KS.again = true; return; }
    KS.running = true; KS.status = 'busy'; KS.renderPill();
    let changedUi = false;
    try {
      const list = await api('/api/kosten/list', { timeout: 15000 });
      KS.online = true;
      const server = {};
      list.items.forEach((it) => { server[it.id] = it; });
      KS.server = server;

      /* 1) Server → Gerät */
      for (const it of list.items) {
        if (it.kind === 'buero') { if (await pullBuero(it)) changedUi = true; continue; }
        if (KS.skip[it.id]) continue;
        const local = STORE.projects[it.id];
        const st = KS.st.docs[it.id];
        const unchanged = local && st && hash(local) === st.hash;
        if (it.deleted) {
          if (!st && !local) continue;
          if (!local) { delete KS.st.docs[it.id]; continue; }
          if (unchanged) { removeLocal(it.id, `Projekt ${pname(local)} wurde von ${it.updatedBy || 'einem anderen Gerät'} gelöscht.`); delete KS.st.docs[it.id]; changedUi = true; }
          else if (st) addConflict(it);
          continue;
        }
        if (st && it.rev <= st.rev) continue;
        if (!local || unchanged) {
          if (local && P && P.id === it.id && isTyping()) continue; // gerade in Bearbeitung → nächster Durchlauf
          const d = await api('/api/kosten/doc/' + encodeURIComponent(it.id), { timeout: 120000 });
          if (d.data) {
            applyServer(it.id, d.data, d.rev, d.updatedAt);
            changedUi = true;
            if (local) say(`Projekt ${pname(STORE.projects[it.id])}: neuer Stand von ${d.updatedBy || 'anderem Gerät'} übernommen.`, 4000);
          }
        } else addConflict(it);
      }

      /* 2) Gerät → Server */
      for (const id of Object.keys(STORE.projects)) {
        if (KS.st.localOnly[id] || KS.skip[id]) continue;
        const p = STORE.projects[id];
        const st = KS.st.docs[id];
        const hh = hash(p);
        if (st && st.hash === hh) continue;
        const sv = server[id];
        if (!st && sv && !sv.deleted) { addConflict(sv); continue; }
        try {
          const r = await api('/api/kosten/doc/' + encodeURIComponent(id), { method: 'PUT', body: { kind: 'project', data: p, baseRev: st ? st.rev : (sv ? sv.rev : 0) }, timeout: 180000 });
          KS.st.docs[id] = { rev: r.rev, hash: hh };
          STORE.dirty[id] = 0; STORE.lastSave[id] = 'NAS ' + nowStr();
          KS.saveState(); changedUi = true;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) { addConflict((e.body && e.body.current) || { id, rev: 0 }); continue; }
          if (e instanceof ApiError && e.status === 403) { KS.st.localOnly[id] = 1; KS.saveState(); say(`Projekt ${pname(p)}: kein Zugriff am Server – bleibt nur in diesem Browser.`, 6000); continue; }
          throw e;
        }
      }

      /* 3) lokal gelöschte Projekte */
      for (const id of Object.keys(KS.st.docs)) {
        if (id === 'buero' || STORE.projects[id]) continue;
        const st = KS.st.docs[id];
        const sv = server[id];
        if (!sv || sv.deleted) { delete KS.st.docs[id]; continue; }
        try {
          await api('/api/kosten/doc/' + encodeURIComponent(id), { method: 'PUT', body: { kind: 'project', data: null, baseRev: st.rev } });
          delete KS.st.docs[id];
        } catch (e) {
          if (e instanceof ApiError && (e.status === 409 || e.status === 403)) {
            delete KS.st.docs[id];
            say(e.status === 403 ? `Projekt ${sv.projNr} kann am Server nur vom Ersteller oder einem Administrator gelöscht werden – es wird wieder geladen.` : `Projekt ${sv.projNr} wurde inzwischen auf einem anderen Gerät geändert und daher nicht gelöscht.`, 7000);
            KS.again = true;
            continue;
          }
          throw e;
        }
      }
      KS.saveState();

      /* 4) Büro-Einstellungen (Logo, Stempel …) */
      await pushBuero(server.buero);

      /* 5) Originalrechnungen (PDF) */
      await syncFiles();

      KS.status = KS.conflicts.length ? 'conflict' : 'ok';
      KS.lastSync = new Date(); KS.lastError = '';
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { KS.status = 'login'; }
      else if (e instanceof ApiError) { KS.status = 'error'; KS.lastError = e.message; console.warn('[Kosten-Sync]', e); }
      else { KS.status = 'offline'; KS.online = false; }
    } finally {
      KS.running = false;
      KS.saveState();
      if (changedUi) refreshUi();
      KS.renderPill();
      KS.nextConflict();
      if (KS.again) { KS.again = false; setTimeout(() => KS.sync(), 300); }
    }
  };

  function isTyping() {
    const a = document.activeElement;
    return !!(a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable));
  }

  function refreshUi() {
    try {
      if (!STORE.projects[STORE.current]) { const o = START.list()[0]; if (o) { STORE.current = o.id; P = o; } }
      else P = STORE.projects[STORE.current];
      UI.refresh();
      if (START.isOpen) START.render();
    } catch (e) { console.warn(e); }
  }

  function applyServer(id, data, rev, updatedAt) {
    const p = normalizeProject(data);
    STORE.projects[id] = p;
    if (P && P.id === id) P = p;
    STORE.dirty[id] = 0; STORE.lastSave[id] = 'NAS ' + fmtTime(updatedAt);
    KS.st.docs[id] = { rev, hash: hash(p) };
    delete KS.st.localOnly[id];
    try { if (RPS.ok && p.rpData) { RPS.saved[id] = null; RPS.saveSoon(); } } catch (e) { }
    KS.saveState();
    callPersist();
  }

  /** Speichern im Browser, ohne einen neuen Abgleich anzustoßen */
  function callPersist() { try { RPS.lsSave(); RPS.saveSoon(); } catch (e) { } }

  function removeLocal(id, msg) {
    delete STORE.projects[id]; delete STORE.dirty[id];
    try { delete RPS.saved[id]; } catch (e) { }
    if (P && P.id === id) {
      const other = START.list()[0];
      if (other) { STORE.current = other.id; P = other; }
      else { const np = emptyProject(); np.meta.projekt = 'Neues Projekt'; STORE.projects[np.id] = np; STORE.current = np.id; P = np; KS.st.localOnly[np.id] = 1; }
      if (!START.isOpen) START.open();
    }
    callPersist();
    if (msg) say(msg, 6000);
  }

  async function pullBuero(it) {
    const st = KS.st.docs.buero;
    if (it.deleted || (st && it.rev <= st.rev)) return false;
    const lh = hash(STORE.buero);
    if (st && lh !== st.hash) return false; // eigene Änderung gewinnt (wird gleich übertragen)
    const d = await api('/api/kosten/doc/buero');
    if (!d.data) return false;
    STORE.buero = Object.assign(defaultBuero(), d.data);
    KS.st.docs.buero = { rev: d.rev, hash: hash(STORE.buero) };
    callPersist();
    return true;
  }

  async function pushBuero(sv) {
    const st = KS.st.docs.buero;
    const hh = hash(STORE.buero);
    if (st && st.hash === hh) return;
    if (!st && sv) { // Server hat schon Büro-Daten, dieses Gerät noch nie abgeglichen → Server übernehmen
      const d = await api('/api/kosten/doc/buero');
      if (d.data) { STORE.buero = Object.assign(defaultBuero(), d.data); KS.st.docs.buero = { rev: d.rev, hash: hash(STORE.buero) }; callPersist(); refreshUi(); return; }
    }
    try {
      const r = await api('/api/kosten/doc/buero', { method: 'PUT', body: { kind: 'buero', data: STORE.buero, baseRev: st ? st.rev : 0 } });
      KS.st.docs.buero = { rev: r.rev, hash: hh };
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const cur = (e.body && e.body.current) || {};
        const r = await api('/api/kosten/doc/buero', { method: 'PUT', body: { kind: 'buero', data: STORE.buero, baseRev: cur.rev || 0 } });
        KS.st.docs.buero = { rev: r.rev, hash: hh };
      } else throw e;
    }
  }

  function docIds(p) {
    const out = [];
    const d = p && p.rpData;
    if (!d) return out;
    (d.re || []).forEach((i) => (i.docs || []).forEach((x) => x && x.id && out.push(x.id)));
    Object.values(d.au || {}).forEach((a) => ((a && a.docs) || []).forEach((x) => x && x.id && out.push(x.id)));
    return out;
  }

  async function syncFiles() {
    if (typeof RPS === 'undefined' || !RPS.ready || !RPS.ok) return;
    for (const id of Object.keys(STORE.projects)) {
      if (KS.st.localOnly[id]) continue;
      for (const fid of docIds(STORE.projects[id])) {
        if (!/^[a-zA-Z0-9_-]{4,80}$/.test(fid)) continue;
        const known = KS.st.files[fid];
        if (known === 2) continue; // hochgeladen und lokal vorhanden
        let blob = await RPS.get('file:' + fid);
        if (blob) {
          await api('/api/kosten/files/' + encodeURIComponent(fid), { method: 'PUT', raw: blob, timeout: 300000 });
          KS.st.files[fid] = 2;
        } else {
          try {
            blob = await api('/api/kosten/files/' + encodeURIComponent(fid), { timeout: 300000 });
            if (blob instanceof Blob) { await RPS.set('file:' + fid, blob); KS.st.files[fid] = 2; }
          } catch (e) {
            if (!(e instanceof ApiError && e.status === 404)) throw e;
            KS.st.files[fid] = 1; // am Server (noch) nicht vorhanden
          }
        }
        KS.saveState();
      }
    }
  }

  /* ---------------- Konflikte ---------------- */
  function addConflict(sv) {
    if (KS.conflicts.some((c) => c.id === sv.id)) return;
    KS.conflicts.push({ id: sv.id, server: sv });
    KS.skip[sv.id] = true;
  }

  KS.nextConflict = function () {
    if (!KS.booted || document.getElementById('ks-modal')) return;
    const c = KS.conflicts[0];
    if (!c) return;
    const local = STORE.projects[c.id];
    const sv = c.server || {};
    if (!local) { KS.conflicts.shift(); delete KS.skip[c.id]; KS.soon(); return KS.nextConflict(); }
    const del = !!sv.deleted;
    const body = del
      ? `<p>Das Projekt <b>${h(pname(local))}</b> wurde von <b>${h(sv.updatedBy || 'einem anderen Benutzer')}</b> (${h(fmtTime(sv.updatedAt))}) am Server <b>gelöscht</b>.</p><p>In diesem Browser gibt es dazu noch nicht übertragene Änderungen.</p>`
      : `<p>Das Projekt <b>${h(pname(local))}</b> wurde zwischenzeitlich von <b>${h(sv.updatedBy || 'einem anderen Gerät')}</b> (${h(fmtTime(sv.updatedAt))}) am Server geändert.</p><p>Auch in diesem Browser gibt es Änderungen, die noch nicht übertragen sind. Welcher Stand soll gelten?</p>`;
    const btns = del
      ? [
        { t: 'Projekt wiederherstellen (meinen Stand hochladen)', cls: 'pri', fn: () => resolve(c, 'mine') },
        { t: 'Löschen übernehmen', fn: () => resolve(c, 'drop') },
      ]
      : [
        { t: 'Beide behalten (meinen Stand als Kopie)', cls: 'pri', fn: () => resolve(c, 'copy') },
        { t: 'Stand vom Server übernehmen', fn: () => resolve(c, 'server') },
        { t: 'Meinen Stand übertragen (Server-Stand überschreiben)', fn: () => resolve(c, 'mine') },
      ];
    modal('Gleichzeitige Änderung', body + '<p class="ks-muted">Bei „Stand vom Server übernehmen“ und „Löschen übernehmen“ wird dein Stand vorher als .json-Datei heruntergeladen. Am Server bleiben außerdem die letzten fünf Stände jedes Projekts erhalten.</p>', btns, false);
  };

  function backupDownload(p) {
    try {
      const data = JSON.stringify({ app: 'Kostenverfolgung Hochbau', format: 1, saved: new Date().toISOString(), project: p, buero: Object.assign({}, STORE.buero) }, null, 1);
      const name = `${String((p.meta && p.meta.projNr) || 'Projekt').replace(/[\\/:*?"<>|\s]+/g, '_')}_Konflikt-Sicherung_${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
      IO.download(data, name, 'application/json');
    } catch (e) { console.warn(e); }
  }

  async function resolve(c, how) {
    closeModal();
    const local = STORE.projects[c.id];
    const sv = c.server || {};
    try {
      if (how === 'server') {
        backupDownload(local);
        const d = await api('/api/kosten/doc/' + encodeURIComponent(c.id));
        if (d.data) applyServer(c.id, d.data, d.rev, d.updatedAt);
        say('Stand vom Server übernommen. Dein bisheriger Stand wurde als Datei gesichert.', 6000);
      } else if (how === 'drop') {
        backupDownload(local);
        removeLocal(c.id); delete KS.st.docs[c.id];
      } else if (how === 'mine') {
        const r = await api('/api/kosten/doc/' + encodeURIComponent(c.id), { method: 'PUT', body: { kind: 'project', data: local, baseRev: sv.rev || 0 }, timeout: 180000 });
        KS.st.docs[c.id] = { rev: r.rev, hash: hash(local) };
        STORE.dirty[c.id] = 0; STORE.lastSave[c.id] = 'NAS ' + nowStr();
        say('Dein Stand wurde übertragen.', 4000);
      } else if (how === 'copy') {
        const copy = JSON.parse(JSON.stringify(local));
        copy.id = uid('p');
        copy.meta.projekt = (copy.meta.projekt || '') + ' (Kopie ' + nowStr() + ')';
        copy.log = copy.log || [];
        copy.log.unshift({ ts: new Date().toISOString(), user: STORE.user || '', text: 'Kopie wegen gleichzeitiger Änderung angelegt' });
        STORE.projects[copy.id] = copy; STORE.dirty[copy.id] = 1;
        if (P && P.id === c.id) { P = copy; STORE.current = copy.id; }
        const d = await api('/api/kosten/doc/' + encodeURIComponent(c.id));
        if (d.data) applyServer(c.id, d.data, d.rev, d.updatedAt);
        if (STORE.current === copy.id) P = copy;
        say(`Server-Stand übernommen, dein Stand liegt als Kopie „${copy.meta.projekt}“ vor.`, 7000);
      }
      KS.conflicts = KS.conflicts.filter((x) => x.id !== c.id);
      delete KS.skip[c.id];
      KS.saveState(); callPersist(); refreshUi();
    } catch (e) {
      say('Konflikt konnte nicht gelöst werden: ' + (e.message || e) + ' – wird später erneut angezeigt.', 7000);
      KS.conflicts = KS.conflicts.filter((x) => x.id !== c.id);
      delete KS.skip[c.id];
    }
    KS.sync();
  }

  /* ---------------- Anmeldung ---------------- */
  KS.unauthorized = function () {
    ls.del(LS_TOKEN);
    KS.status = 'login';
    KS.renderPill();
    KS.showLogin();
  };

  KS.showLogin = function () {
    KS.status = 'login';
    if (document.getElementById('ks-login')) return;
    const el = document.createElement('div');
    el.id = 'ks-login';
    el.innerHTML = `<form class="ks-card" autocomplete="on">
      <div class="ks-title">Kostenverfolgung Hochbau</div>
      <div class="ks-muted" style="margin-bottom:14px">Anmeldung mit dem Konto des Protokollwesens</div>
      <label>E-Mail<input type="email" name="email" autocomplete="username" required value="${h((KS.storedUser() || {}).email || '')}"></label>
      <label>Passwort<input type="password" name="password" autocomplete="current-password" required></label>
      <div class="ks-err" id="ks-login-err"></div>
      <button class="ks-btn pri" type="submit">Anmelden</button>
      ${KS.booted ? '' : '<button class="ks-btn" type="button" id="ks-offline">Ohne Anmeldung nur in diesem Browser arbeiten</button>'}
    </form>`;
    document.body.appendChild(el);
    const f = el.querySelector('form');
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = el.querySelector('#ks-login-err'); err.textContent = '';
      try {
        const r = await api('/api/login', { body: { email: f.email.value.trim(), password: f.password.value, device: 'Kostenverfolgung · ' + (navigator.platform || 'Browser') }, login: true });
        ls.set(LS_TOKEN, r.token); ls.set(LS_USER, JSON.stringify(r.user));
        location.reload();
      } catch (e) { err.textContent = e instanceof ApiError ? e.message : 'Server nicht erreichbar'; }
    });
    const off = el.querySelector('#ks-offline');
    if (off) off.addEventListener('click', () => { el.remove(); KS.status = 'login'; runBoot(); });
    setTimeout(() => { const i = f.email.value ? f.password : f.email; i && i.focus(); }, 50);
  };

  KS.logout = async function () {
    if (KS.pendingCount() > 0 && !confirm('Es gibt noch nicht übertragene Änderungen. Trotzdem abmelden?')) return;
    try { await api('/api/logout', { method: 'POST' }); } catch (e) { }
    ls.del(LS_TOKEN); ls.del(LS_USER);
    location.reload();
  };

  /* ---------------- Anzeige ---------------- */
  const css = document.createElement('style');
  css.textContent = `
  #ks-pill{position:fixed;left:12px;bottom:12px;z-index:2147483000;display:flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;background:#0f172a;color:#fff;font:600 11px/1.2 Calibri,Carlito,'Segoe UI',Arial,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.25);cursor:pointer;user-select:none;opacity:.92}
  #ks-pill:hover{opacity:1}
  #ks-pill i{width:9px;height:9px;border-radius:50%;display:inline-block;background:#94a3b8}
  #ks-pill.ok i{background:#34d399}#ks-pill.busy i{background:#38bdf8;animation:ksp 1s infinite}#ks-pill.pending i{background:#fbbf24}
  #ks-pill.offline i{background:#94a3b8}#ks-pill.conflict i,#ks-pill.error i,#ks-pill.login i{background:#f43f5e}
  @keyframes ksp{50%{opacity:.3}}
  #ks-login,#ks-modal{position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;font:14px/1.45 Calibri,Carlito,'Segoe UI',Arial,sans-serif;color:#0f172a}
  #ks-login{background:#e2e8f0}
  .ks-card{background:#fff;border-radius:12px;padding:22px 24px;width:100%;max-width:440px;box-shadow:0 10px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:8px;max-height:90vh;overflow:auto}
  .ks-card.wide{max-width:560px}
  .ks-card label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:#475569}
  .ks-card input[type=email],.ks-card input[type=password]{font:inherit;padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px}
  .ks-title{font-size:18px;font-weight:700;color:#002E5E}
  .ks-muted{color:#64748b;font-size:12px}
  .ks-err{color:#be123c;font-size:12px;min-height:1em}
  .ks-btn{font:inherit;font-size:13px;padding:8px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#0f172a;cursor:pointer;text-align:center}
  .ks-btn:hover{background:#f1f5f9}.ks-btn.pri{background:#002E5E;border-color:#002E5E;color:#fff}.ks-btn.pri:hover{background:#0b4a8a}
  .ks-btn.sm{font-size:12px;padding:4px 9px}
  .ks-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .ks-sec{border-top:1px solid #e2e8f0;padding-top:10px;margin-top:6px}
  .ks-sec h4{margin:0 0 6px;font-size:13px;color:#002E5E}
  .ks-list{display:flex;flex-direction:column;gap:4px;font-size:12px}
  .ks-list label{flex-direction:row;align-items:center;gap:6px;color:#0f172a;font-size:12px}
  .ks-note{margin-top:12px;padding:8px 12px;border-radius:8px;background:#ecfdf5;border:1px solid #a7f3d0;font-size:12px;color:#065f46}
  .ks-note a{color:#002E5E;font-weight:600;margin-left:6px}
  @media print{#ks-pill{display:none}}
  `;
  document.head.appendChild(css);

  KS.renderPill = function () {
    let el = document.getElementById('ks-pill');
    if (!el) {
      el = document.createElement('div'); el.id = 'ks-pill'; el.title = 'Server-Abgleich (NAS)';
      el.addEventListener('click', () => KS.openPanel());
      document.body.appendChild(el);
    }
    const n = KS.booted ? KS.pendingCount() : 0;
    let cls = KS.status, txt;
    switch (KS.status) {
      case 'busy': txt = 'Wird abgeglichen …'; break;
      case 'offline': txt = n ? `Offline – ${n} Änderung(en) warten` : 'Offline – lokal gespeichert'; break;
      case 'login': txt = 'Nicht angemeldet – nur lokal'; break;
      case 'conflict': txt = 'Konflikt – bitte entscheiden'; break;
      case 'error': txt = 'Fehler beim Abgleich'; break;
      default:
        if (n) { cls = 'pending'; txt = 'Änderungen werden übertragen …'; }
        else txt = 'Auf NAS gespeichert' + (KS.lastSync ? ' · ' + KS.lastSync.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' }) : '');
    }
    el.className = cls;
    el.innerHTML = `<i></i><span>${h(txt)}</span>`;
  };

  function modal(title, body, btns, wide) {
    closeModal();
    const el = document.createElement('div');
    el.id = 'ks-modal';
    el.innerHTML = `<div class="ks-card ${wide ? 'wide' : ''}"><div class="ks-title">${h(title)}</div><div>${body}</div><div class="ks-row" style="flex-direction:column;align-items:stretch;margin-top:8px">${btns.map((b, i) => `<button class="ks-btn ${b.cls || ''}" data-i="${i}">${h(b.t)}</button>`).join('')}</div></div>`;
    document.body.appendChild(el);
    el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => btns[Number(b.dataset.i)].fn()));
    return el;
  }
  function closeModal() { const m = document.getElementById('ks-modal'); if (m) m.remove(); }
  KS.close = closeModal;

  KS.openPanel = async function () {
    if (!KS.user || !ls.get(LS_TOKEN)) { KS.showLogin(); return; }
    const cur = P && STORE.projects[P.id] ? P : null;
    const sv = cur ? KS.server[cur.id] : null;
    const st = cur ? KS.st.docs[cur.id] : null;
    const isLocal = cur && KS.st.localOnly[cur.id];
    const canShare = sv && !sv.deleted && (KS.user.role === 'admin' || sv.owner === KS.user.id);
    let body = `<div class="ks-muted">Angemeldet als <b>${h(KS.user.name)}</b> (${KS.user.role === 'admin' ? 'Administrator' : 'Mitarbeiter'})</div>
      <div class="ks-muted">Letzter Abgleich: ${KS.lastSync ? h(KS.lastSync.toLocaleString('de-AT')) : '–'}${KS.lastError ? ' · <span style="color:#be123c">' + h(KS.lastError) + '</span>' : ''}</div>`;
    if (cur) {
      body += `<div class="ks-sec"><h4>Aktuelles Projekt: ${h(pname(cur))}</h4>`;
      if (isLocal) body += `<div class="ks-muted">Dieses Projekt liegt nur in diesem Browser (z. B. Beispielprojekt) und wird nicht übertragen.</div><div class="ks-row" style="margin-top:6px"><button class="ks-btn sm pri" id="ks-upload">Auf den Server übertragen</button></div>`;
      else if (sv && st) body += `<div class="ks-muted">Am Server: Stand ${sv.rev} · zuletzt geändert von ${h(sv.updatedBy || '–')} am ${h(fmtTime(sv.updatedAt))}</div><div class="ks-row" style="margin-top:6px"><button class="ks-btn sm" id="ks-hist">Frühere Stände …</button></div>`;
      else body += `<div class="ks-muted">Noch nicht am Server – wird beim nächsten Abgleich übertragen.</div>`;
      if (canShare) body += `<div style="margin-top:8px"><div class="ks-muted" style="margin-bottom:4px">Freigegeben für Mitarbeiter (Administratoren sehen alle Projekte):</div><div class="ks-list" id="ks-access">wird geladen …</div></div>`;
      body += `</div>`;
    }
    const m = modal('Server-Abgleich (NAS)', body, [
      { t: 'Jetzt abgleichen', cls: 'pri', fn: () => { closeModal(); KS.sync(); } },
      { t: '← Zum Protokollwesen', fn: () => { location.href = '/'; } },
      { t: 'Abmelden', fn: () => KS.logout() },
      { t: 'Schließen', fn: closeModal },
    ], true);
    m.addEventListener('click', (e) => { if (e.target === m) closeModal(); });
    const up = m.querySelector('#ks-upload');
    if (up) up.addEventListener('click', () => { delete KS.st.localOnly[cur.id]; KS.saveState(); closeModal(); KS.sync(); });
    const hi = m.querySelector('#ks-hist');
    if (hi) hi.addEventListener('click', () => KS.history(cur.id));
    const acc = m.querySelector('#ks-access');
    if (acc) {
      try {
        if (!KS.users) KS.users = await api('/api/users');
        const staff = KS.users.filter((u) => u.role !== 'admin' && u.active);
        const sel = new Set(sv.access || []);
        acc.innerHTML = staff.length
          ? staff.map((u) => `<label><input type="checkbox" value="${h(u.id)}" ${sel.has(u.id) ? 'checked' : ''}> ${h(u.name)} <span class="ks-muted">${h(u.email)}</span></label>`).join('')
          : '<span class="ks-muted">Keine Mitarbeiter-Konten vorhanden.</span>';
        acc.querySelectorAll('input').forEach((cb) => cb.addEventListener('change', async () => {
          const ids = [...acc.querySelectorAll('input:checked')].map((x) => x.value);
          try { await api('/api/kosten/access/' + encodeURIComponent(cur.id), { method: 'PUT', body: { access: ids } }); sv.access = ids; say('Freigabe gespeichert'); }
          catch (e) { say('Freigabe nicht gespeichert: ' + e.message, 5000); }
        }));
      } catch (e) { acc.textContent = 'Benutzerliste nicht verfügbar (offline?)'; }
    }
  };

  KS.history = async function (id) {
    let items = [];
    try { items = (await api('/api/kosten/history/' + encodeURIComponent(id))).items; } catch (e) { say('Frühere Stände nicht verfügbar: ' + e.message, 5000); return; }
    const body = items.length
      ? `<p class="ks-muted">Ein früherer Stand wird als <b>Kopie</b> geöffnet – das aktuelle Projekt bleibt unverändert.</p><div class="ks-list">${items.map((x) => `<div class="ks-row" style="justify-content:space-between"><span>Stand ${x.rev} · ${h(fmtTime(x.updated_at))} · ${h(x.updated_by || '')}</span><button class="ks-btn sm" data-rev="${x.rev}">Als Kopie öffnen</button></div>`).join('')}</div>`
      : '<p class="ks-muted">Noch keine früheren Stände vorhanden.</p>';
    const m = modal('Frühere Stände', body, [{ t: 'Schließen', fn: closeModal }], true);
    m.querySelectorAll('[data-rev]').forEach((b) => b.addEventListener('click', async () => {
      try {
        const data = await api(`/api/kosten/history/${encodeURIComponent(id)}/${b.dataset.rev}`);
        const p = normalizeProject(data);
        p.id = uid('p');
        p.meta.projekt = (p.meta.projekt || '') + ` (Stand ${b.dataset.rev})`;
        STORE.projects[p.id] = p; STORE.dirty[p.id] = 0; STORE.current = p.id; P = p;
        KS.st.localOnly[p.id] = 1; KS.saveState();
        callPersist(); closeModal(); refreshUi();
        say('Früherer Stand als Kopie geöffnet (nur in diesem Browser). Bei Bedarf über den Server-Abgleich hochladen.', 7000);
      } catch (e) { say('Laden fehlgeschlagen: ' + e.message, 5000); }
    }));
  };
})();
