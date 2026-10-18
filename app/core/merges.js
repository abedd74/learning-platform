// Merge strategies of the family sync: (local, remote) → merged.
//
// The first six are ported one-to-one from the old sync.js — they decide how
// two devices' copies of a key are combined, and the children's data has
// been merged by exactly these rules for months. Their behaviour is pinned
// by tests/merges.test.mjs. New strategies are appended below for v2 keys.
//
// All functions are pure and tolerate null/undefined/odd input.

import { parseLegacyDate } from './time.js';

export function parse(raw) { try { return JSON.parse(raw); } catch { return null; } }

/** Scalar maximum (high scores). */
export function mergeMax(a, b) { return Math.max(Number(a) || 0, Number(b) || 0); }

/** SRS stores {cardId: {b,due,s,…}}: per card, the entry with more practice wins. */
export function mergeSrs(a, b) {
  const out = Object.assign({}, a || {});
  for (const [w, e] of Object.entries(b || {})) {
    const l = out[w];
    if (!l) { out[w] = e; continue; }
    out[w] =
      e.s !== l.s ? (e.s > l.s ? e : l) :
      e.b !== l.b ? (e.b > l.b ? e : l) :
      ((e.due || '') > (l.due || '') ? e : l);
  }
  return out;
}

/** {key: {numeric fields}} → field-wise maximum; non-numbers keep the local value. */
export function mergeMaxPerEntry(a, b) {
  const out = Object.assign({}, a || {});
  for (const [k, v] of Object.entries(b || {})) {
    if (!out[k] || typeof v !== 'object' || v === null) { out[k] = out[k] ?? v; continue; }
    const m = Object.assign({}, out[k]);
    for (const [f, val] of Object.entries(v)) {
      m[f] = (typeof val === 'number' && typeof m[f] === 'number') ? Math.max(m[f], val) : (m[f] ?? val);
    }
    out[k] = m;
  }
  return out;
}

/**
 * Like mergeMaxPerEntry, but nested objects are merged the same way instead
 * of the local one winning whole. Used for the Lernpfad state (gram_path),
 * whose units passed / Meister-Check fields are nested — the flat rule let
 * one device keep an older state (STOCKTAKE §6). A superset of the flat
 * rule: identical for flat entries.
 */
export function mergeMaxPerEntryDeep(a, b) {
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
  const rec = (x, y) => {
    if (!isObj(x) || !isObj(y)) return x ?? y;
    const m = Object.assign({}, x);
    for (const [f, val] of Object.entries(y)) {
      if (typeof val === 'number' && typeof m[f] === 'number') m[f] = Math.max(m[f], val);
      else if (isObj(val) && isObj(m[f])) m[f] = rec(m[f], val);
      else m[f] = m[f] ?? val;
    }
    return m;
  };
  const out = Object.assign({}, a || {});
  for (const [k, v] of Object.entries(b || {})) {
    if (!out[k] || !isObj(v)) { out[k] = out[k] ?? v; continue; }
    out[k] = rec(out[k], v);
  }
  return out;
}

/** Arrays: union without duplicates; objects: recursive union. */
export function mergeDeepUnion(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    const seen = new Set(a.map(x => JSON.stringify(x)));
    return a.concat(b.filter(x => !seen.has(JSON.stringify(x))));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = Object.assign({}, a);
    for (const [k, v] of Object.entries(b)) out[k] = (k in out) ? mergeDeepUnion(out[k], v) : v;
    return out;
  }
  return a ?? b;
}

/** Round history: union by (date,time,module,mode,pct), chronological, last 10. */
export function histSortKey(h) {
  // Accepts the old app's unpadded '5.3.2026' as well as '05.03.2026' (the
  // old sort key only understood the padded form, STOCKTAKE §6).
  const day = parseLegacyDate(h?.date);
  return day ? `${day} ${h.time || ''}` : `0000 ${h?.date || ''}`;
}
export function histId(h) { return [h?.date, h?.time, h?.module, h?.mode, h?.pct].join('|'); }
export function mergeHistory(a, b) {
  const la = Array.isArray(a) ? a : [], lb = Array.isArray(b) ? b : [];
  const seen = new Set(la.map(histId));
  const merged = la.concat(lb.filter(h => !seen.has(histId(h))));
  merged.sort((x, y) => histSortKey(x).localeCompare(histSortKey(y)));
  return merged.slice(-10);
}

/**
 * Old editor bank {topic: [questions], __meta:{topics:{topic:{ts}}}}: topic by
 * topic, the newer timestamp wins; without timestamps the longer list, on a
 * tie the local one.
 */
export function mergeEditorBank(a, b) {
  a = (a && typeof a === 'object') ? a : {};
  b = (b && typeof b === 'object') ? b : {};
  const metaA = a.__meta?.topics || {};
  const metaB = b.__meta?.topics || {};
  const out = {}, outMeta = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === '__meta') continue;
    const va = a[k], vb = b[k];
    const ta = Number(metaA[k]?.ts || 0), tb = Number(metaB[k]?.ts || 0);
    let takeA;
    if (va === undefined)      takeA = false;
    else if (vb === undefined) takeA = true;
    else if (ta !== tb)        takeA = ta > tb;
    else {
      const la = Array.isArray(va) ? va.length : -1;
      const lb = Array.isArray(vb) ? vb.length : -1;
      takeA = la >= lb;
    }
    out[k] = takeA ? va : vb;
    const m = takeA ? metaA[k] : metaB[k];
    if (m) outMeta[k] = m;
  }
  if (Object.keys(outMeta).length) out.__meta = { topics: outMeta };
  return out;
}

// ── new in v2 ─────────────────────────────────────────────────────────────

/** Whole-value newest: the object with the larger updatedAt wins (plan_<P>). */
export function mergeNewest(a, b) {
  if (!a || typeof a !== 'object') return b ?? a;
  if (!b || typeof b !== 'object') return a;
  return (Number(b.updatedAt) || 0) > (Number(a.updatedAt) || 0) ? b : a;
}

/** family_profiles {v, profiles:{<P>: {…, updatedAt}}}: union; per profile the newer updatedAt wins. */
export function mergeProfiles(a, b) {
  const pa = a?.profiles || {}, pb = b?.profiles || {};
  const profiles = Object.assign({}, pa);
  for (const [k, v] of Object.entries(pb)) {
    const l = profiles[k];
    if (!l) { profiles[k] = v; continue; }
    profiles[k] = (Number(v?.updatedAt) || 0) > (Number(l?.updatedAt) || 0) ? v : l;
  }
  return { v: Math.max(Number(a?.v) || 1, Number(b?.v) || 1), profiles };
}

export const ERROR_LOG_MAX = 200;

/** app_errors [{ts, v, page, msg, stack}]: union by (ts, msg), by time, last 200. */
export function mergeErrorLog(a, b) {
  const la = Array.isArray(a) ? a : [], lb = Array.isArray(b) ? b : [];
  const id = e => `${e?.ts}|${e?.msg}`;
  const seen = new Set(la.map(id));
  const merged = la.concat(lb.filter(e => !seen.has(id(e))));
  merged.sort((x, y) => (Number(x?.ts) || 0) - (Number(y?.ts) || 0));
  return merged.slice(-ERROR_LOG_MAX);
}

/** Strategy name (as used in the storage registry) → function. */
export const STRATEGIES = Object.freeze({
  max: mergeMax,
  srs: mergeSrs,
  maxPerEntry: mergeMaxPerEntry,
  maxPerEntryDeep: mergeMaxPerEntryDeep,
  deepUnion: mergeDeepUnion,
  history: mergeHistory,
  editorBank: mergeEditorBank,
  newest: mergeNewest,
  profiles: mergeProfiles,
  errorLog: mergeErrorLog,
});
