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
// <day>), and a refusal to run on a namespaced (staging) store.
// Hardened after the 2026-11 review (DECISIONS 2026-11-15): one odd entry no
// longer blocks the other keys; an unload flush never writes before this page
// has merged with the cloud once; a push re-reads the device after waiting
// for the cloud; bringing back a snapshot MERGES it in (it refills what is
// missing and never lowers newer progress) and is pushed at once.

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
  onError = null,   // (Error) → the app's error log; called for failures a parent should see
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

  // An HTTP answer that says "this one document is refused" (bad request,
  // forbidden, too large): the other keys can still go through.
  function httpError(what, status) {
    const err = new Error(`${what} ${status}`);
    err.status = status;
    err.keyOnly = status === 400 || status === 403 || status === 413;
    return err;
  }

  async function listDocs(url, extra = '') {
    const out = [];
    let token = '';
    for (let page = 0; page < 20; page++) {
      const res = await fetch(withKey(`${url}?pageSize=300${extra}${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`));
      if (!res.ok) throw httpError('list', res.status);
      const data = await res.json();
      for (const d of data.documents || []) out.push({ key: decodeURIComponent(d.name.split('/').pop()), ...docFields(d) });
      token = data.nextPageToken || '';
      if (!token) break;
    }
    return out;
  }

  async function getDoc(url) {
    const res = await fetch(withKey(url));
    if (res.status === 404) return null;
    if (!res.ok) throw httpError('get', res.status);
    return docFields(await res.json());
  }

  // PATCH without updateMask replaces the whole document; keepalive lets a
  // small request survive the page being unloaded.
  async function patchFields(url, fields, keepalive) {
    const body = JSON.stringify({ fields });
    const init = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body };
    if (keepalive && body.length < 60000) init.keepalive = true;
    const res = await fetch(withKey(url), init);
    if (!res.ok) throw httpError('patch', res.status);
  }

  async function deleteDoc(url) {
    const res = await fetch(withKey(url), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw httpError('delete', res.status);
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

  // Merge two copies by rule; a failure is tagged so that only this key is skipped.
  function mergeRaw(merge, key, localRaw, remoteRaw) {
    try { return JSON.stringify(merge(parse(localRaw), parse(remoteRaw))); }
    catch (cause) {
      const err = new Error(`Eintrag "${key}" lässt sich nicht zusammenführen: ${cause?.message || cause}`);
      err.keyOnly = true;
      throw err;
    }
  }

  const reported = new Set();
  /** Tell the app's error log once per page and topic (never throws). */
  function report(topic, err) {
    log.warn?.(`[FamilySync] ${topic}:`, err?.message);
    if (reported.has(topic)) return;
    reported.add(topic);
    try { onError?.(new Error(`Sync – ${topic}: ${err?.message || err}`)); } catch {}
  }

  /** One cloud document into the device. Returns true when the local value changed. */
  function pullOne(d) {
    const merge = ruleFor(d.key);
    if (!keyInfo(d.key)?.sync) return false;     // unknown or device-local key in the cloud: ignore
    const localRaw = store.getRaw(d.key);
    const seenTs = metaAll()[d.key] || 0;

    // remote tombstone: adopt the deletion — unless the key has local,
    // not yet pushed changes (dirty); those win and the next push revives it
    if (d.deleted) {
      let changed = false;
      if (d.ts > seenTs) {
        if (localRaw !== null && !dirty.has(d.key)) {
          store.removeRaw(d.key);
          tombSet(d.key, d.ts);
          changed = true;
        }
        metaSet(d.key, d.ts);
      }
      return changed;
    }
    if (d.json === null) return false;

    let finalRaw;
    if (localRaw === null) {
      // deleted locally? revive only if the cloud data is YOUNGER than our tombstone
      const tombTs = tombAll()[d.key] || 0;
      if (tombTs >= d.ts) { dirty.add(d.key); return false; }
      if (tombTs) tombClear(d.key);
      finalRaw = d.json;
    } else if (merge) {
      finalRaw = mergeRaw(merge, d.key, localRaw, d.json);
    } else {
      // last-write-wins: never displace local data while it is unsaved (dirty)
      finalRaw = (dirty.has(d.key) || d.ts <= seenTs) ? localRaw : d.json;
    }
    let changed = false;
    if (finalRaw !== localRaw) {
      if (!store.setRaw(d.key, finalRaw)) throw Object.assign(new Error(`Speicher voll: "${d.key}" konnte nicht geschrieben werden`), { keyOnly: true });
      changed = true;
    }
    if (merge && finalRaw !== d.json) dirty.add(d.key);   // merging produced news for the cloud too
    metaSet(d.key, d.ts);
    return changed;
  }

  async function pullAll() {
    if (!enabled()) return;
    setStatus('sync');
    const changed = [];
    try {
      const docs = await listDocs(storesUrl());
      const remoteKeys = new Set();
      for (const d of docs) {
        remoteKeys.add(d.key);
        // one odd entry must not stop the others (it is reported and tried again next time)
        try { if (pullOne(d)) changed.push(d.key); }
        catch (err) { report(`Abgleich von ${d.key}`, err); }
      }
      // first start: local keys the cloud does not have yet go up
      for (const k of store.list()) if (ruleFor(k) && !remoteKeys.has(k)) dirty.add(k);
      lastPull = now();
      setStatus('ok');
      if (dirty.size) schedulePush();
      if (changed.length) dispatch('familysync-pulled', { keys: changed });
      try { await maybeSnapshot(); } catch (err) { report('tägliche Sicherung', err); }
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

  /** Push one key. flush=true: no reads first, a quick keepalive write. */
  async function pushOne(key, flush) {
    const merge = ruleFor(key);
    if (store.getRaw(key) === null) {
      // deleted key → push the tombstone, unless another device wrote
      // newer data after our deletion — then the data wins and we revive it
      const tombTs = tombAll()[key];
      if (!tombTs) return;
      if (!flush) {
        const remote = await getDoc(storeDoc(key));
        if (remote && !remote.deleted && remote.json !== null && remote.ts > tombTs) {
          store.setRaw(key, remote.json);
          tombClear(key);
          metaSet(key, remote.ts);
          dispatch('familysync-pulled', { keys: [key] });
          return;
        }
      }
      await patchTombstone(key, tombTs, flush);
      return;
    }
    let finalRaw = store.getRaw(key);
    if (!flush && merge) {
      const remote = await getDoc(storeDoc(key));
      // read the device again AFTER waiting: an answer saved meanwhile must not be overwritten
      const localRaw = store.getRaw(key);
      if (localRaw === null) { dirty.add(key); return; }
      finalRaw = localRaw;
      if (remote && remote.json !== null) {
        finalRaw = mergeRaw(merge, key, localRaw, remote.json);
        if (finalRaw !== localRaw) store.setRaw(key, finalRaw);
      }
    }
    await patchStore(key, finalRaw, flush);
    tombClear(key);
  }

  // flush=true: the page is being unloaded — no reads first, only quick
  // keepalive writes; a skipped merge is caught up by the other device's pull.
  // A flush never runs before this page has merged with the cloud once: an
  // old device that could not pull would otherwise put its stale copy on top.
  async function pushDirty(flush = false) {
    if (!enabled() || !dirty.size) return;
    if (flush && !lastPull) return;
    setStatus('sync');
    const list = [...dirty]; dirty.clear();
    let failed = 0;
    if (flush) {
      // all at once: an unloading page may not live long enough for a queue
      const results = await Promise.allSettled(list.map(key => pushOne(key, true)));
      results.forEach((r, i) => { if (r.status === 'rejected') { failed++; dirty.add(list[i]); } });
    } else {
      for (let i = 0; i < list.length; i++) {
        try { await pushOne(list[i], false); }
        catch (err) {
          failed++;
          dirty.add(list[i]);   // retry on the next occasion
          if (err?.keyOnly) { report(`Hochladen von ${list[i]}`, err); continue; }
          // the cloud is not reachable: keep the rest for later instead of failing one by one
          log.warn?.('[FamilySync] push failed:', err?.message);
          for (const k of list.slice(i + 1)) dirty.add(k);
          break;
        }
      }
    }
    setStatus(failed ? 'offline' : 'ok');
  }

  // ── backup parachute: export / import ──────────────────────────────────
  function exportAll() {
    const data = {};
    for (const k of store.list()) if (ruleFor(k)) data[k] = store.getRaw(k);
    return { v: 1, exportedAt: new Date(now()).toISOString(), data };
  }

  /** Merge a {key: raw} map into the device by rule. Returns {n, changed}: keys looked at / keys that gained something. */
  function mergeIn(data) {
    let n = 0, changed = 0;
    const touched = [];
    for (const [k, raw] of Object.entries(data || {})) {
      const merge = ruleFor(k);
      if (!merge || typeof raw !== 'string') continue;
      const localRaw = store.getRaw(k);
      let finalRaw;
      try { finalRaw = localRaw ? mergeRaw(merge, k, localRaw, raw) : raw; }
      catch (err) { report(`Einlesen von ${k}`, err); continue; }
      n++;
      if (finalRaw !== localRaw) { if (!store.setRaw(k, finalRaw)) continue; changed++; tombClear(k); }
      dirty.add(k); touched.push(k);
    }
    if (touched.length) dispatch('familysync-pulled', { keys: touched });
    return { n, changed };
  }

  function importAll(fileText) {
    const payload = typeof fileText === 'string' ? parse(fileText) : fileText;
    if (!payload || !payload.data || typeof payload.data !== 'object') throw new Error('Keine gültige Backup-Datei.');
    const { n } = mergeIn(payload.data);
    if (n && enabled()) schedulePush();
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

  /**
   * Bring a snapshot back: MERGE it into the device by the same rules as the
   * sync, then push at once. This refills what went missing (a lost key, lost
   * cards) and never lowers newer progress — a "more practice wins" merge
   * cannot be undone by any device alone (DECISIONS 2026-11-15).
   * Returns {n, changed, pushed}.
   */
  async function restoreSnapshot(day) {
    const snap = await getSnapshot(day);
    if (!snap) throw new Error('Snapshot nicht gefunden.');
    const { n, changed } = mergeIn(snap.data);
    if (pushTimer) { timers.clear(pushTimer); pushTimer = null; }
    await pushDirty();
    return { n, changed, pushed: dirty.size === 0 };
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
