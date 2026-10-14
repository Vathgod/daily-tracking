'use strict';

// Data lives in this browser (localStorage + IndexedDB for screenshots) and,
// once a token is set, is synced to data.json in a private GitHub repo.
// Every item carries updatedAt; deletes are kept as { deleted: true } so
// two devices can merge without losing or resurrecting items.

const idb = (() => {
  let dbp;
  function open() {
    if (!dbp) {
      dbp = new Promise((res, rej) => {
        const r = indexedDB.open('daily-tracking', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('shots');
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction('shots', mode);
      const req = fn(t.objectStore('shots'));
      t.oncomplete = () => res(req && req.result);
      t.onerror = () => rej(t.error);
    });
  }
  return {
    get: k => tx('readonly', s => s.get(k)),
    set: (k, v) => tx('readwrite', s => s.put(v, k)),
    del: k => tx('readwrite', s => s.delete(k)),
  };
})();

const Store = (() => {
  const LS_STATE = 'dt.state';
  const LS_CFG = 'dt.config';
  const DATA_PATH = 'data.json';
  const KINDS = ['tasks', 'trades', 'accounts'];

  let state = blank();
  const cfg = { owner: 'Vathgod', repo: 'daily-tracking-data', token: '' };
  let status = 'local';
  let lastError = '';
  let syncTimer = null;
  let syncing = null;
  let again = false;
  const listeners = new Set();
  const shotUrls = new Map();

  function blank() {
    return { tasks: {}, trades: {}, accounts: {}, settings: { lossLimit: 0, updatedAt: 0 } };
  }

  function normalize(o) {
    const s = blank();
    const put = (dst, list) => {
      for (const it of Array.isArray(list) ? list : Object.values(list || {})) {
        if (it && it.id) dst[it.id] = it;
      }
    };
    if (o) {
      put(s.tasks, o.tasks);
      put(s.trades, o.trades);
      put(s.accounts, o.accounts);
      if (o.settings) s.settings = { ...s.settings, ...o.settings };
    }
    return s;
  }

  function serialize(s) {
    const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.time || '').localeCompare(b.time || '');
    return {
      version: 1,
      settings: s.settings,
      tasks: Object.values(s.tasks).sort(byDate),
      trades: Object.values(s.trades).sort(byDate),
      accounts: Object.values(s.accounts).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)),
    };
  }

  function merge(a, b) {
    const s = blank();
    for (const k of KINDS) {
      const ids = new Set([...Object.keys(a[k]), ...Object.keys(b[k])]);
      for (const id of ids) {
        const x = a[k][id], y = b[k][id];
        s[k][id] = !x ? y : !y ? x : (y.updatedAt || 0) > (x.updatedAt || 0) ? y : x;
      }
    }
    s.settings = (b.settings.updatedAt || 0) > (a.settings.updatedAt || 0) ? b.settings : a.settings;
    return s;
  }

  // Cheap fingerprint: which items exist and when each was last changed.
  function sig(s) {
    const part = m => Object.keys(m).sort().map(id => id + ':' + (m[id].updatedAt || 0)).join(',');
    return KINDS.map(k => part(s[k])).join('|') + '|' + (s.settings.updatedAt || 0);
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_STATE);
      if (raw) state = normalize(JSON.parse(raw));
    } catch (e) { /* keep blank state */ }
    try {
      Object.assign(cfg, JSON.parse(localStorage.getItem(LS_CFG)) || {});
    } catch (e) { /* defaults */ }
    status = cfg.token ? 'idle' : 'local';
  }

  function persist() {
    try {
      localStorage.setItem(LS_STATE, JSON.stringify(state));
    } catch (e) {
      lastError = 'Could not save on this device: ' + e.message;
    }
  }

  function emit() { for (const fn of listeners) fn(); }

  function setStatus(s) { status = s; emit(); }

  function list(kind) {
    return Object.values(state[kind]).filter(x => !x.deleted);
  }

  function upsert(kind, item) {
    item.updatedAt = Date.now();
    state[kind][item.id] = item;
    persist();
    emit();
    scheduleSync();
    return item;
  }

  function remove(kind, id) {
    const it = state[kind][id];
    if (!it) return;
    const shot = it.shot;
    state[kind][id] = { id, deleted: true, updatedAt: Date.now() };
    persist();
    emit();
    scheduleSync();
    if (shot) deleteShot(shot);
  }

  function setSettings(patch) {
    state.settings = { ...state.settings, ...patch, updatedAt: Date.now() };
    persist();
    emit();
    scheduleSync();
  }

  // ---------- GitHub ----------

  function api(path, opt = {}) {
    const url = `https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`;
    return fetch(url, {
      cache: 'no-store',
      ...opt,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + cfg.token,
        ...(opt.headers || {}),
      },
    });
  }

  async function apiError(r) {
    let msg = '';
    try { msg = (await r.json()).message || ''; } catch (e) { /* no body */ }
    if (r.status === 401) return new Error('Token is wrong or expired.');
    if (r.status === 403) return new Error('Token has no permission for this repo. ' + msg);
    if (r.status === 404) return new Error('Repo not found, or the token cannot see it.');
    return new Error(`GitHub error ${r.status}. ${msg}`);
  }

  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  function b64dec(b64) {
    const bin = atob(b64.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }

  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  async function pull() {
    const r = await api('/contents/' + DATA_PATH);
    if (r.status === 404) {
      // Either the file doesn't exist yet (fine) or the repo is unreachable.
      const repo = await api('');
      if (!repo.ok) throw await apiError(repo);
      return { data: null, sha: null };
    }
    if (!r.ok) throw await apiError(r);
    const j = await r.json();
    let text;
    if (j.content) {
      text = b64dec(j.content);
    } else {
      // Files over 1 MB come back without inline content.
      const r2 = await api('/contents/' + DATA_PATH, { headers: { Accept: 'application/vnd.github.raw' } });
      if (!r2.ok) throw await apiError(r2);
      text = await r2.text();
    }
    return { data: JSON.parse(text), sha: j.sha };
  }

  async function push(s, sha) {
    const body = {
      message: 'Update data ' + new Date().toISOString(),
      content: b64enc(JSON.stringify(serialize(s), null, 1)),
    };
    if (sha) body.sha = sha;
    const r = await api('/contents/' + DATA_PATH, { method: 'PUT', body: JSON.stringify(body) });
    if (r.status === 409 || r.status === 422) return { conflict: true };
    if (!r.ok) throw await apiError(r);
    return { sha: (await r.json()).content.sha };
  }

  async function uploadPendingShots(s) {
    for (const t of Object.values(s.trades)) {
      if (t.deleted || !t.shot || t.shot.store !== 'local') continue;
      const blob = await idb.get(t.shot.id);
      if (!blob) continue;
      const path = `shots/${t.shot.id}.jpg`;
      const r = await api('/contents/' + path, {
        method: 'PUT',
        body: JSON.stringify({ message: 'Add screenshot', content: await blobToB64(blob) }),
      });
      if (!r.ok && r.status !== 422) throw await apiError(r); // 422 = already uploaded
      s.trades[t.id] = { ...t, shot: { id: t.shot.id, store: 'gh', path }, updatedAt: Date.now() };
    }
  }

  function scheduleSync() {
    if (!cfg.token) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(syncNow, 1200);
  }

  function syncNow() {
    if (!cfg.token) return Promise.resolve();
    if (syncing) { again = true; return syncing; }
    syncing = (async () => {
      setStatus('syncing');
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          const remote = await pull();
          const remoteState = normalize(remote.data);
          const merged = merge(state, remoteState);
          await uploadPendingShots(merged);
          // Merge again so edits made while uploading aren't lost.
          state = merge(state, merged);
          persist();
          if (remote.sha && sig(state) === sig(remoteState)) {
            lastError = '';
            setStatus('synced');
            return;
          }
          const r = await push(state, remote.sha);
          if (r.conflict) continue;
          lastError = '';
          setStatus('synced');
          return;
        }
        throw new Error('Another device was saving at the same time. Try again.');
      } catch (e) {
        lastError = e.message || String(e);
        setStatus(navigator.onLine === false ? 'offline' : 'error');
      } finally {
        syncing = null;
        if (again) { again = false; syncNow(); }
      }
    })();
    return syncing;
  }

  async function testConnection(owner, repo, token) {
    const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + token },
    });
    if (!r.ok) {
      const saved = { ...cfg };
      Object.assign(cfg, { owner, repo, token });
      const err = await apiError(r);
      Object.assign(cfg, saved);
      throw err;
    }
    const j = await r.json();
    if (j.permissions && !j.permissions.push) throw new Error('Token can read but not write. Give it "Contents: Read and write".');
    return { private: j.private, fullName: j.full_name };
  }

  function setConfig(c) {
    Object.assign(cfg, c);
    try { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    status = cfg.token ? 'idle' : 'local';
    lastError = '';
    emit();
  }

  // ---------- Screenshots ----------

  async function compress(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('Could not read that image.'));
        i.src = url;
      });
      const max = 1400;
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      return await new Promise(res => c.toBlob(res, 'image/jpeg', 0.72));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function saveShot(file) {
    const blob = await compress(file);
    const id = U.uid();
    await idb.set(id, blob);
    shotUrls.set(id, URL.createObjectURL(blob));
    return { id, store: 'local' };
  }

  async function shotUrl(shot) {
    if (!shot) return '';
    if (shotUrls.has(shot.id)) return shotUrls.get(shot.id);
    let blob = await idb.get(shot.id).catch(() => null);
    if (!blob && shot.store === 'gh' && cfg.token) {
      const r = await api('/contents/' + shot.path, { headers: { Accept: 'application/vnd.github.raw' } });
      if (!r.ok) throw await apiError(r);
      blob = await r.blob();
      idb.set(shot.id, blob).catch(() => {});
    }
    if (!blob) return '';
    const u = URL.createObjectURL(blob);
    shotUrls.set(shot.id, u);
    return u;
  }

  async function deleteShot(shot) {
    idb.del(shot.id).catch(() => {});
    if (shot.store !== 'gh' || !cfg.token) return;
    try {
      const r = await api('/contents/' + shot.path);
      if (!r.ok) return;
      const { sha } = await r.json();
      await api('/contents/' + shot.path, {
        method: 'DELETE',
        body: JSON.stringify({ message: 'Remove screenshot', sha }),
      });
    } catch (e) { /* the file just stays in the repo */ }
  }

  // ---------- Backup ----------

  function exportJSON() {
    return JSON.stringify({ ...serialize(state), exportedAt: new Date().toISOString() }, null, 1);
  }

  function importJSON(text) {
    const incoming = normalize(JSON.parse(text));
    const n = KINDS.reduce((sum, k) => sum + Object.keys(incoming[k]).length, 0);
    state = merge(state, incoming);
    persist();
    emit();
    scheduleSync();
    return n;
  }

  return {
    load, list, upsert, remove, setSettings, syncNow, testConnection, setConfig,
    saveShot, shotUrl, deleteShot, exportJSON, importJSON,
    get: (kind, id) => state[kind][id],
    settings: () => state.settings,
    config: () => ({ ...cfg }),
    status: () => status,
    lastError: () => lastError,
    on: fn => listeners.add(fn),
  };
})();
