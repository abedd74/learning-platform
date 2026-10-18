// The key registry and the storage layer.
//
// This is the ONLY file that may spell a localStorage key name. Every key the
// app reads or writes is listed in REGISTRY with its pattern, its sync rule
// and its shape. The children's progress hangs on these names: the old app
// wrote them, the cloud mirrors them, and v2 keeps every one of them
// unchanged (docs/MIGRATION.md). New data goes into NEW keys, appended here.
//
// <P> is a profile's storage name — today identical to the display name the
// old app had in its code. It comes from the device and the family sync at
// runtime (profiles.js); this file never contains one.
//
// Namespace: the staging shell (/next/) sets a prefix so that the new app
// writes next_<key> and never touches the live keys (DESIGN §10).

export const REGISTRY = [
  // ── quiz modules (old index.html) ───────────────────────────────────────
  { id: 'quizHistory',    re: /^wq_(?!deck_|stats_|editor|srs_)(\S+)$/, build: p => `wq_${p}`,
    sync: 'history', scope: 'profile', since: 1,
    shape: 'array of up to 10 rounds {date "D.M.YYYY", time, mode, pct, module, topics:{t:{pts,max}}}' },
  { id: 'quizStats',      re: /^wq_stats_(.+)$/, build: p => `wq_stats_${p}`,
    sync: 'maxPerEntry', scope: 'profile', since: 1,
    shape: '{questionId: {shown, correct, wrong, lastSeen}}' },
  { id: 'quizSrs',        re: /^wq_srs_(.+)$/, build: p => `wq_srs_${p}`,
    sync: 'srs', scope: 'profile', since: 1,
    shape: '{questionId: {b, due, s, r, w, k, lz?}}' },
  { id: 'editorVersion',  re: /^wq_editor_QB\w*_ver$/, build: suffix => `wq_editor_QB${suffix}_ver`,
    sync: null, scope: 'device', since: 1, writable: false,
    shape: 'raw string schema stamp of the old editor' },
  { id: 'editorBank',     re: /^wq_editor_QB(?!\w*_ver$)(\w*)$/, build: suffix => `wq_editor_QB${suffix}`,
    sync: 'editorBank', scope: 'family', since: 1, writable: false,
    shape: '{topic: [question objects], __meta:{topics:{topic:{ts}}}} — old in-app editor overrides, read once for export' },
  { id: 'quizDeck',       re: /^wq_deck_(.+)$/, build: p => `wq_deck_${p}`,
    sync: 'deepUnion', scope: 'profile', since: 1, writable: false,
    shape: 'legacy deck of seen questions; no longer written' },
  { id: 'customProfiles', re: /^custom_profiles$/, build: () => 'custom_profiles',
    sync: null, scope: 'device', since: 1, writable: false,
    shape: '[{name, avatar}] — old device-local extra profiles, read for migration' },

  // ── Deutsch mit Ella (old grammatik.html) ───────────────────────────────
  { id: 'gramSrs',        re: /^gram_srs_(.+)$/, build: p => `gram_srs_${p}`,
    sync: 'srs', scope: 'profile', since: 1,
    shape: '{noun: {b, due, s, r, w, k, lz?}} — also written by Wort-Regen' },
  { id: 'gramDays',       re: /^gram_days_(.+)$/, build: p => `gram_days_${p}`,
    sync: 'maxPerEntry', scope: 'profile', since: 1,
    shape: '{day: {a, c, n, m, ms, sess, v, g}} — trainer day counters' },
  { id: 'gramCase',       re: /^gram_case_(.+)$/, build: p => `gram_case_${p}`,
    sync: 'maxPerEntry', scope: 'profile', since: 1,
    shape: '{akk|dat: {a, c, gErr, cErr, bothErr}}' },
  { id: 'gramBadges',     re: /^gram_badges_(.+)$/, build: p => `gram_badges_${p}`,
    sync: 'deepUnion', scope: 'profile', since: 1,
    shape: '{badgeId: day}' },
  { id: 'gramPath',       re: /^gram_path_(.+)$/, build: p => `gram_path_${p}`,
    sync: 'maxPerEntry', scope: 'profile', since: 1,
    shape: '{akk|dat|nomen: {unit, passed:{n:ts}, fest:{day:n}, mc:{tries,passed,nextTry}, gBox, gDue}}' },
  { id: 'gramLastProfile', re: /^gram_lastProfile$/, build: () => 'gram_lastProfile',
    sync: null, scope: 'device', since: 1, writable: false,
    shape: 'JSON string: last profile of the old trainer' },
  { id: 'gramSound',      re: /^gram_sound_on$/, build: () => 'gram_sound_on',
    sync: null, scope: 'device', since: 1, writable: false, shape: 'JSON bool' },
  { id: 'gramItalian',    re: /^gram_it_on$/, build: () => 'gram_it_on',
    sync: null, scope: 'device', since: 1, writable: false, shape: 'JSON bool' },

  // ── Wort-Regen (old wortregen.html) ─────────────────────────────────────
  { id: 'wrHigh',         re: /^wr_high_(.+)$/, build: p => `wr_high_${p}`,
    sync: 'max', scope: 'profile', since: 1, shape: 'number (high score)' },
  { id: 'wrStats',        re: /^wr_stats_(.+)$/, build: p => `wr_stats_${p}`,
    sync: 'deepUnion', scope: 'profile', since: 1,
    shape: '{sessionId: {ts, mode, pool, catches, repairs, mistakes, wrongByArt, wordsWrong, rowsMax, dur, score, hearts, end, speedEnd}} — last 60' },
  { id: 'wrSound',        re: /^wr_sound$/, build: () => 'wr_sound',
    sync: null, scope: 'device', since: 1, writable: false, shape: "raw '0' or '1'" },

  // ── FamilySync bookkeeping (sync.js) ────────────────────────────────────
  { id: 'familyId',       re: /^family_sync_id$/, build: () => 'family_sync_id',
    sync: null, scope: 'device', since: 1, secret: true,
    shape: 'raw string: THE FAMILY CODE — never log, show or copy it' },
  { id: 'familyMeta',     re: /^family_sync_meta$/, build: () => 'family_sync_meta',
    sync: null, scope: 'device', since: 1, shape: '{key: last seen cloud ts}' },
  { id: 'familyTombstones', re: /^family_sync_tombstones$/, build: () => 'family_sync_tombstones',
    sync: null, scope: 'device', since: 1, shape: '{key: deletion ts}' },

  // ── new in v2 ───────────────────────────────────────────────────────────
  { id: 'familyProfiles', re: /^family_profiles$/, build: () => 'family_profiles',
    sync: 'profiles', scope: 'family', since: 2,
    shape: '{v:1, profiles:{<P>: {name, avatar, grade, gentle, createdAt, updatedAt, deleted?}}}' },
  { id: 'mapSrs',         re: /^map_srs_(.+)$/, build: p => `map_srs_${p}`,
    sync: 'srs', scope: 'profile', since: 2,
    shape: '{"<regionId>:<skill>": {b, due, s, r, w, k, lz?}}' },
  { id: 'planDays',       re: /^plan_days_(.+)$/, build: p => `plan_days_${p}`,
    sync: 'maxPerEntry', scope: 'profile', since: 2,
    shape: '{day: {a, c, n, ms, sess}} — answers, first-try right, new cards, practice ms, sessions, across all modules' },
  { id: 'plan',           re: /^plan_(?!days_)(.+)$/, build: p => `plan_${p}`,
    sync: 'newest', scope: 'profile', since: 2,
    shape: '{updatedAt, tests:{moduleId: day}, focus?:[moduleId]}' },
  { id: 'appErrors',      re: /^app_errors$/, build: () => 'app_errors',
    sync: 'errorLog', scope: 'family', since: 2,
    shape: '[{ts, v, page, msg, stack}] — last 200' },
  { id: 'appProfile',     re: /^app_profile$/, build: () => 'app_profile',
    sync: null, scope: 'device', since: 2, shape: 'JSON string: <P> last chosen on this device' },
  { id: 'appSettings',    re: /^app_settings$/, build: () => 'app_settings',
    sync: null, scope: 'device', since: 2,
    shape: '{sound, italian, parentPin?} — device settings' },
];

const byId = Object.fromEntries(REGISTRY.map(e => [e.id, e]));

/** Key builders: keys.quizSrs('<P>') → 'wq_srs_<P>' */
export const keys = Object.fromEntries(REGISTRY.map(e => [e.id, e.build]));

/** Registry entry for a key name, or null if the key is not registered. */
export function keyInfo(key) {
  if (typeof key !== 'string') return null;
  for (const e of REGISTRY) if (e.re.test(key)) return e;
  return null;
}

export function isRegistered(key) { return keyInfo(key) !== null; }

/** The <P> part of a profile-scoped key, or null. */
export function profileOf(key) {
  const e = keyInfo(key);
  if (!e || e.scope !== 'profile') return null;
  return e.re.exec(key)[1];
}

/** In-memory backend with the localStorage interface (tests, private mode). */
export function memoryBackend(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: i => [...m.keys()][i] ?? null,
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
  };
}

/**
 * Create the storage layer.
 *   backend   object with the localStorage interface (default: window.localStorage)
 *   namespace prefix for every key ('' live, 'next_' staging)
 *   onDirty   called with the logical key after set()  → FamilySync.markDirty
 *   onRemove  called with the logical key after remove() → FamilySync tombstone
 */
export function createStore({ backend, namespace = '', onDirty = null, onRemove = null, log = console } = {}) {
  const be = backend ?? (typeof localStorage !== 'undefined' ? localStorage : memoryBackend());
  const ns = namespace || '';
  const phys = key => ns + key;

  function getRaw(key) {
    try { return be.getItem(phys(key)); } catch { return null; }
  }
  function setRaw(key, raw) {
    try { be.setItem(phys(key), String(raw)); return true; }
    catch (err) { log.warn?.(`[storage] cannot write "${key}"`, err?.name || err); return false; }
  }
  function removeRaw(key) {
    try { be.removeItem(phys(key)); } catch {}
  }

  /** Parsed value, or fallback when absent or corrupt (a corrupt entry is dropped locally so the cloud copy can return). */
  function get(key, fallback = null) {
    const raw = getRaw(key);
    if (raw === null || raw === '') return fallback;
    try { return JSON.parse(raw); }
    catch (err) {
      log.warn?.(`[storage] corrupt entry "${key}" dropped`, err?.message);
      removeRaw(key);
      return fallback;
    }
  }

  function assertWritable(key) {
    const e = keyInfo(key);
    if (!e) throw new Error(`[storage] unregistered key "${key}" — add it to REGISTRY in app/core/storage.js`);
    if (e.writable === false) throw new Error(`[storage] key "${key}" is legacy/read-only`);
    return e;
  }

  /** Store a JSON value under a registered key and mark it dirty for the sync. */
  function set(key, value) {
    assertWritable(key);
    const ok = setRaw(key, JSON.stringify(value));
    if (ok) onDirty?.(key);
    return ok;
  }

  /** Remove a key; the sync layer leaves a tombstone so the deletion reaches other devices. */
  function remove(key) {
    assertWritable(key);
    removeRaw(key);
    onRemove?.(key);
  }

  function has(key) { return getRaw(key) !== null; }

  /** Logical keys present in this namespace. */
  function list() {
    const out = [];
    let n = 0;
    try { n = be.length; } catch { return out; }
    for (let i = 0; i < n; i++) {
      let k = null;
      try { k = be.key(i); } catch { continue; }
      if (k === null) continue;
      if (ns) { if (k.startsWith(ns)) out.push(k.slice(ns.length)); }
      else out.push(k);
    }
    return out;
  }

  /**
   * Staging only: copy the live (un-namespaced) registered keys into this
   * namespace. The family code is never copied, so a staging build can never
   * reach the cloud. Returns the number of keys copied.
   */
  function copyFromLive() {
    if (!ns) throw new Error('[storage] copyFromLive needs a namespace');
    let count = 0, n = 0;
    try { n = be.length; } catch { return 0; }
    const names = [];
    for (let i = 0; i < n; i++) { try { const k = be.key(i); if (k !== null) names.push(k); } catch {} }
    for (const k of names) {
      if (k.startsWith(ns)) continue;
      const e = keyInfo(k);
      if (!e || e.secret) continue;
      let raw = null;
      try { raw = be.getItem(k); } catch {}
      if (raw === null) continue;
      if (setRaw(k, raw)) count++;
    }
    return count;
  }

  return { get, set, remove, has, getRaw, setRaw, removeRaw, list, copyFromLive, namespace: ns, keyInfo, keys };
}

export { byId as registryById };
