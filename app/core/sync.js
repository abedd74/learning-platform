// FamilySync — cloud mirror of the progress keys, local first.
//
// Ported from the old sync.js (same documents, same merge rules, same
// tombstones), as an ES module with everything injectable for tests:
//   - the app only ever reads and writes the store (localStorage); this
//     module pulls once at start (and when the tab becomes visible again, at
//     most once a minute) and pushes changed keys 5 s after a change
//   - transport: Firestore REST, no SDK, no accounts; the long random family
//     code in the path is the secret. It is read once from ?familie=…,
//     stored under the registry's familyId key, scrubbed from the address
//     bar, and never exposed by this module (no getter, no event, no log).
//   - which keys sync, and how two copies merge, comes from the registry
//     (storage.js) and merges.js. Keys without a rule stay on the device.
//   - deletions travel as tombstones {deleted:true, ts}
// New in v2: daily snapshots of all synced keys (families/<code>/snapshots/
// <day>) with restore, and a refusal to run on a namespaced (staging) store.

import { STRATEGIES, parse } from './merges.js';
import { keyInfo, keys as K } from './storage.js';
import { today as todayOf, isDay } from './time.js';

// Public Firebase web config (not a secret; protection = Firestore rules + the family code in the path).
export const CONFIG = Object.freeze({
  projectId: 'lernplattform-e37fb',
  apiKey: 'AIzaSyAAY8ZR9fTht5zCdT1TcaY-8oyoaCxULuw',
});

export const PUSH_DEBOUNCE_MS = 5000;
export const PULL_MIN_INTERVAL_MS = 60000;
export const SNAPSHOT_KEEP = 30;
export const SNAPSHOT_MAX_BYTES = 900000;
const SNAPSHOT_META = '__snapshot';   // entry in family_sync_meta: last day a snapshot was ensured

/** Merge strategy for a key, or null when the key is device-local. */
export function ruleFor(key) {
  const e = keyInfo(key);
  if (!e || !e.sync) return null;
  return STRATEGIES[e.sync] || null;
}

/**
 * Create the sync. `store` is a storage layer from createStore(); everything
 * else has browser defaults and is overridable for tests.
 */
export function createFamilySync({
  store,
  fetch = globalThis.fetch?.bind(globalThis),
  now = Date.now,
  today = () => todayOf(new Date(now())),
  location = globalThis.location,
  history = globalThis.history,
  document = globalThis.document,
  dispatch = (name, detail) => { try { globalThis.dispatchEvent(new CustomEvent(name, { detail })); } catch {} },
  timers = { set: (f, ms) => setTimeout(f, ms), clear: id => clearTimeout(id) },
  config = CONFIG,
  disabled = false,
  allowNamespaced = false,
  snapshotKeep = SNAPSHOT_KEEP,
  log = console,
} = {}) {
  if (!store) throw new TypeError('FamilySync: store is required');
  if (store.namespace && !allowNamespaced) disabled = true;   // staging never reaches the cloud

  const FAMILY_KEY = K.familyId(), META_KEY = K.familyMeta(), TOMB_KEY = K.familyTombstones();

  // ── family code ────────────────────────────────────────────────────────
  function familyId() {
    try {
      const search = location?.search || '';
      if (search) {
        const params = new URLSearchParams(search);
        const fromUrl = params.get('familie');
        if (fromUrl) {
          store.setRaw(FAMILY_KEY, fromUrl);
          // scrub the secret from the address bar (history, bookmarks, screenshots)
          params.delete('familie');
          const clean = location.pathname + (params.toString() ? '?' + params.toString() : '') + (location.hash || '');
          try { history?.replaceState(null, '', clean); } catch {}
        }
      }
      return store.getRaw(FAMILY_KEY);
    } catch { return null; }
  }
  const enabled = () => !disabled && typeof fetch === 'function' && !config.projectId.startsWith('PASTE') && !!familyId();

  // ── Firestore REST ─────────────────────────────────────────────────────
  const familyUrl = () => `https://firestore.googleapis.com/v1/projects/${config.projectId}` +
    `/databases/(default)/documents/families/${encodeURIComponent(familyId())}`;
  const storesUrl = () => `${familyUrl()}/stores`;
  const snapshotsUrl = () => `${familyUrl()}/snapshots`;
  const withKey = url => url + (url.includes('?') ? '&' : '?') + `key=${config.apiKey}`;

  function docFields(d) {
    return {
      json:    d.fields?.json?.stringValue ?? null,
      ts:      Number(d.fields?.ts?.integerValue || 0),
      n:       Number(d.fields?.n?.integerValue || 0),
      deleted: d.fields?.deleted?.booleanValue === true,
    };
  }

  async function listDocs(url, extra = '') {
    const res = await fetch(withKey(`${url}?pageSize=300${extra}`));
    if (!res.ok) throw new Error(`list ${res.status}`);
    const data = await res.json();
    return (data.documents || []).map(d => ({ key: decodeURIComponent(d.name.split('/').pop()), ...docFields(d) }));
  }

  async function getDoc(url) {
    const res = await fetch(withKey(url));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`get ${res.status}`);
    return docFields(await res.json());
  }

  // PATCH without updateMask replaces the whole document; keepalive lets a
  // small request survive the page being unloaded.
  async function patchFields(url, fields, keepalive) {
    const body = JSON.stringify({ fields });
    const init = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body };
    if (keepalive && body.length < 60000) init.keepalive = true;
    const res = await fetch(withKey(url), init);
    if (!res.ok) throw new Error(`patch ${res.status}`);
  }

  async function deleteDoc(url) {
    const res = await fetch(withKey(url), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`delete ${res.status}`);
  }

  const storeDoc = key => `${storesUrl()}/${encodeURIComponent(key)}`;

  async function patchStore(key, raw, keepalive) {
    const ts = now();
    await patchFields(storeDoc(key), { json: { stringValue: raw }, ts: { integerValue: String(ts) } }, keepalive);
    metaSet(key, ts);
  }
  async function patchTombstone(key, ts, keepalive) {
    await patchFields(storeDoc(key), { deleted: { booleanValue: true }, ts: { integerValue: String(ts) } }, keepalive);
    metaSet(key, ts);
  }

  // ── bookkeeping (device-local) ─────────────────────────────────────────
  const metaAll = () => parse(store.getRaw(META_KEY)) || {};
  function metaSet(key, ts) { const m = metaAll(); m[key] = ts; store.setRaw(META_KEY, JSON.stringify(m)); }
  const tombAll = () => parse(store.getRaw(TOMB_KEY)) || {};
  function tombSet(key, ts) { const t = tombAll(); t[key] = ts; store.setRaw(TOMB_KEY, JSON.stringify(t)); }
  function tombClear(key) { const t = tombAll(); if (!(key in t)) return; delete t[key]; store.setRaw(TOMB_KEY, JSON.stringify(t)); }

  // ── status ─────────────────────────────────────────────────────────────
  let status = 'aus';   // aus | sync | ok | offline
  function setStatus(s) { status = s; dispatch('familysync-status', { status: s }); }

  // ── pull ───────────────────────────────────────────────────────────────
  const dirty = new Set();
  let lastPull = 0;
  let pushTimer = null;

  async function pullAll() {
    if (!enabled()) return;
    setStatus('sync');
    const changed = [];
    try {
      const docs = await listDocs(storesUrl());
      const remoteKeys = new Set();
      for (const d of docs) {
        remoteKeys.add(d.key);
        const merge = ruleFor(d.key);
        if (!merge && !keyInfo(d.key)?.sync) {
          if (!keyInfo(d.key)) continue;           // unknown key: ignore
        }
        if (!keyInfo(d.key)?.sync) continue;       // device-local key in the cloud (should not happen): ignore
        const localRaw = store.getRaw(d.key);
        const seenTs = metaAll()[d.key] || 0;

        // remote tombstone: adopt the deletion — unless the key has local,
        // not yet pushed changes (dirty); those win and the next push revives it
        if (d.deleted) {
          if (d.ts > seenTs) {
            if (localRaw !== null && !dirty.has(d.key)) {
              store.removeRaw(d.key);
              tombSet(d.key, d.ts);
              changed.push(d.key);
            }
            metaSet(d.key, d.ts);
          }
          continue;
        }
        if (d.json === null) continue;

        let finalRaw;
        if (localRaw === null) {
          // deleted locally? revive only if the cloud data is YOUNGER than our tombstone
          const tombTs = tombAll()[d.key] || 0;
          if (tombTs >= d.ts) { dirty.add(d.key); continue; }
          if (tombTs) tombClear(d.key);
          finalRaw = d.json;
        } else if (merge) {
          finalRaw = JSON.stringify(merge(parse(localRaw), parse(d.json)));
        } else {
          // last-write-wins: never displace local data while it is unsaved (dirty)
          finalRaw = (dirty.has(d.key) || d.ts <= seenTs) ? localRaw : d.json;
        }
        if (finalRaw !== localRaw) { store.setRaw(d.key, finalRaw); changed.push(d.key); }
        if (merge && finalRaw !== d.json) dirty.add(d.key);   // merging produced news for the cloud too
        metaSet(d.key, d.ts);
      }
      // first start: local keys the cloud does not have yet go up
      for (const k of store.list()) if (ruleFor(k) && !remoteKeys.has(k)) dirty.add(k);
      lastPull = now();
      setStatus('ok');
      if (dirty.size) schedulePush();
      if (changed.length) dispatch('familysync-pulled', { keys: changed });
      try { await maybeSnapshot(); } catch (err) { log.warn?.('[FamilySync] snapshot failed:', err?.message); }
    } catch (err) {
      log.warn?.('[FamilySync] pull failed:', err?.message);
      setStatus('offline');
    }
  }

  // ── push ───────────────────────────────────────────────────────────────
  function markDirty(key) {
    if (!ruleFor(key)) return;
    if (store.getRaw(key) !== null) tombClear(key);   // written again → an old tombstone is void
    if (!enabled()) return;
    dirty.add(key);
    schedulePush();
  }

  // Sync-aware deletion: remove locally and leave a tombstone so the deletion
  // reaches the other devices (the store's remove() calls this).
  function remove(key) {
    store.removeRaw(key);
    if (!ruleFor(key)) return;
    tombSet(key, now());
    if (!enabled()) return;
    dirty.add(key);
    schedulePush();
  }

  function schedulePush() {
    if (pushTimer) timers.clear(pushTimer);
    pushTimer = timers.set(() => { pushTimer = null; return pushDirty(); }, PUSH_DEBOUNCE_MS);
  }

  // flush=true: the page is being unloaded — no reads first, only quick
  // keepalive writes; a skipped merge is caught up by the other device's pull.
  async function pushDirty(flush = false) {
    if (!enabled() || !dirty.size) return;
    setStatus('sync');
    const list = [...dirty]; dirty.clear();
    try {
      for (const key of list) {
        const localRaw = store.getRaw(key);
        const merge = ruleFor(key);
        if (localRaw === null) {
          // deleted key → push the tombstone, unless another device wrote
          // newer data after our deletion — then the data wins and we revive it
          const tombTs = tombAll()[key];
          if (!tombTs) continue;
          if (!flush) {
            const remote = await getDoc(storeDoc(key));
            if (remote && !remote.deleted && remote.json !== null && remote.ts > tombTs) {
              store.setRaw(key, remote.json);
              tombClear(key);
              metaSet(key, remote.ts);
              dispatch('familysync-pulled', { keys: [key] });
              continue;
            }
          }
          await patchTombstone(key, tombTs, flush);
          continue;
        }
        let finalRaw = localRaw;
        if (!flush && merge) {
          const remote = await getDoc(storeDoc(key));
          if (remote && remote.json !== null) {
            finalRaw = JSON.stringify(merge(parse(localRaw), parse(remote.json)));
            if (finalRaw !== localRaw) store.setRaw(key, finalRaw);
          }
        }
        await patchStore(key, finalRaw, flush);
        tombClear(key);
      }
      setStatus('ok');
    } catch (err) {
      log.warn?.('[FamilySync] push failed:', err?.message);
      list.forEach(k => dirty.add(k));   // retry on the next occasion
      setStatus('offline');
    }
  }

  // ── backup parachute: export / import ──────────────────────────────────
  function exportAll() {
    const data = {};
    for (const k of store.list()) if (ruleFor(k)) data[k] = store.getRaw(k);
    return { v: 1, exportedAt: new Date(now()).toISOString(), data };
  }

  function importAll(fileText) {
    const payload = typeof fileText === 'string' ? parse(fileText) : fileText;
    if (!payload || !payload.data || typeof payload.data !== 'object') throw new Error('Keine gültige Backup-Datei.');
    let n = 0;
    const imported = [];
    for (const [k, raw] of Object.entries(payload.data)) {
      const merge = ruleFor(k);
      if (!merge || typeof raw !== 'string') continue;
      const localRaw = store.getRaw(k);
      const finalRaw = localRaw ? JSON.stringify(merge(parse(localRaw), parse(raw))) : raw;
      store.setRaw(k, finalRaw);
      dirty.add(k); imported.push(k); n++;
    }
    if (n) { if (enabled()) schedulePush(); dispatch('familysync-pulled', { keys: imported }); }
    return n;
  }

  // ── snapshots (new in v2) ──────────────────────────────────────────────
  function composeSnapshot(day) {
    const data = {};
    for (const k of store.list()) if (ruleFor(k)) data[k] = store.getRaw(k);
    let payload = { v: 1, day, trimmed: [], data };
    let json = JSON.stringify(payload);
    if (json.length > SNAPSHOT_MAX_BYTES) {
      // the old editor banks can be big; leave them out and say so
      for (const k of Object.keys(data)) if (keyInfo(k)?.id === 'editorBank') { delete data[k]; payload.trimmed.push(k); }
      json = JSON.stringify(payload);
    }
    return { json, n: Object.keys(data).length };
  }

  /** Once a day: write families/<code>/snapshots/<day> if it does not exist yet, then prune. */
  async function maybeSnapshot() {
    if (!enabled()) return false;
    const day = today();
    if (metaAll()[SNAPSHOT_META] === day) return false;
    const url = `${snapshotsUrl()}/${day}`;
    const existing = await getDoc(url);
    let wrote = false;
    if (!existing) {
      const { json, n } = composeSnapshot(day);
      if (json.length > SNAPSHOT_MAX_BYTES + 100000) { log.warn?.('[FamilySync] snapshot too large, skipped'); }
      else {
        await patchFields(url, { json: { stringValue: json }, ts: { integerValue: String(now()) }, n: { integerValue: String(n) } });
        wrote = true;
      }
    }
    metaSet(SNAPSHOT_META, day);
    try { await pruneSnapshots(); } catch (err) { log.warn?.('[FamilySync] prune failed:', err?.message); }
    return wrote;
  }

  async function listSnapshots() {
    if (!enabled()) return [];
    const docs = await listDocs(snapshotsUrl(), '&mask.fieldPaths=ts&mask.fieldPaths=n');
    return docs.filter(d => isDay(d.key)).map(d => ({ day: d.key, ts: d.ts, n: d.n })).sort((a, b) => (a.day < b.day ? -1 : 1));
  }

  async function pruneSnapshots() {
    const all = await listSnapshots();
    const old = all.slice(0, Math.max(0, all.length - snapshotKeep));
    for (const s of old) await deleteDoc(`${snapshotsUrl()}/${s.day}`);
    return old.length;
  }

  async function getSnapshot(day) {
    if (!enabled() || !isDay(day)) return null;
    const doc = await getDoc(`${snapshotsUrl()}/${day}`);
    if (!doc || doc.json === null) return null;
    const payload = parse(doc.json);
    if (!payload || typeof payload.data !== 'object') return null;
    return { day, ts: doc.ts, trimmed: payload.trimmed || [], data: payload.data };
  }

  /** Replace the local synced keys with a snapshot's and push them. Returns the number of keys written. */
  async function restoreSnapshot(day) {
    const snap = await getSnapshot(day);
    if (!snap) throw new Error('Snapshot nicht gefunden.');
    let n = 0;
    const written = [];
    for (const [k, raw] of Object.entries(snap.data)) {
      if (!ruleFor(k) || typeof raw !== 'string') continue;
      store.setRaw(k, raw);
      tombClear(k);
      dirty.add(k); written.push(k); n++;
    }
    if (n) { schedulePush(); dispatch('familysync-pulled', { keys: written }); }
    return n;
  }

  // ── start ──────────────────────────────────────────────────────────────
  function init() {
    if (!enabled()) { setStatus('aus'); return false; }
    // protection against displacement on the first pull: never-synced local
    // keys and LWW keys count as dirty; open tombstones are re-announced
    const meta = metaAll();
    for (const k of store.list()) {
      const e = keyInfo(k);
      if (e?.sync && (!(k in meta) || !STRATEGIES[e.sync])) dirty.add(k);
    }
    for (const [k, ts] of Object.entries(tombAll())) if (ruleFor(k) && ts > (meta[k] || 0)) dirty.add(k);
    pullAll();
    try {
      document?.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && now() - lastPull > PULL_MIN_INTERVAL_MS) pullAll();
        if (document.visibilityState === 'hidden' && dirty.size) pushDirty(true);
      });
      globalThis.addEventListener?.('pagehide', () => { if (dirty.size) pushDirty(true); });
    } catch {}
    return true;
  }

  return {
    init, markDirty, remove, pullAll, pushDirty, exportAll, importAll,
    maybeSnapshot, listSnapshots, getSnapshot, restoreSnapshot, pruneSnapshots,
    get status() { return status; },
    get enabled() { return enabled(); },
    get hasFamily() { return !!store.getRaw(FAMILY_KEY); },
    get dirtyCount() { return dirty.size; },
  };
}
