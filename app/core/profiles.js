// Profiles come from the device and the family sync, never from the code.
//
// family_profiles (synced): {v:1, profiles:{<P>: {name, avatar, grade, gentle,
// createdAt, updatedAt, deleted?}}}. <P> is the storage name: it is part of
// every progress key (wq_srs_<P> …), so it never changes once created. On a
// device that already has progress from the old app, the names are
// detected from the key names and offered on the first run — the app never
// ships a name (DESIGN §3).
//
// Device-local: app_profile (the last chosen <P>).

import { keys as K, profileOf, REGISTRY } from './storage.js';

export const PROFILE_VERSION = 1;
export const AVATARS = Object.freeze(['🌺', '🌸', '🦊', '🐬', '🦉', '🐢', '🌈', '⭐', '🦄', '🐉', '🍀', '🎈', '🐼', '🦋', '🚀', '🎨']);
export const GRADES = Object.freeze([1, 2, 3, 4, 5, 6]);
export const PARENT_KEY = 'Eltern';   // the old app's parent "profile": a mode in v2, never a child
export const KEY_MAX = 24;

/** A storage name: letters, digits, '_' and '-', no spaces (a space would break the history sync rule). */
export function validKey(k) {
  return typeof k === 'string' && k.length >= 1 && k.length <= KEY_MAX && /^[\p{L}\p{N}_-]+$/u.test(k) && k !== PARENT_KEY;
}

/** Turn a display name into a storage name: trim, drop spaces and odd characters. */
export function keyFromName(name) {
  const k = String(name || '').normalize('NFC').trim().replace(/[^\p{L}\p{N}_-]+/gu, '');
  return k.slice(0, KEY_MAX);
}

function load(store) {
  const v = store.get(K.familyProfiles(), null);
  return (v && typeof v === 'object' && v.profiles && typeof v.profiles === 'object') ? v : { v: PROFILE_VERSION, profiles: {} };
}

/** Active profiles, oldest first. */
export function listProfiles(store) {
  return Object.entries(load(store).profiles)
    .filter(([, p]) => p && !p.deleted)
    .map(([key, p]) => ({ key, ...p }))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.key.localeCompare(b.key));
}

export function getProfile(store, key) {
  const p = load(store).profiles[key];
  return p && !p.deleted ? { key, ...p } : null;
}

function normalizeGrade(g) {
  if (g === null || g === undefined || g === '') return null;
  const n = Number(g);
  return GRADES.includes(n) ? n : null;
}

/**
 * Create or update a profile. For a new profile `key` may be omitted (derived
 * from the name). Returns the saved profile. Throws on an invalid key.
 */
export function saveProfile(store, { key, name, avatar, grade, gentle }, now = Date.now()) {
  const data = load(store);
  const k = key ?? keyFromName(name);
  if (!validKey(k)) throw new Error(`Ungültiger Profilname: "${name ?? key}"`);
  const old = data.profiles[k];
  const p = {
    name: String(name ?? old?.name ?? k).trim() || k,
    avatar: avatar ?? old?.avatar ?? AVATARS[0],
    grade: grade === undefined ? (old?.grade ?? null) : normalizeGrade(grade),
    gentle: gentle === undefined ? !!old?.gentle : !!gentle,
    createdAt: old?.createdAt ?? now,
    updatedAt: now,
  };
  data.profiles[k] = p;
  data.v = PROFILE_VERSION;
  store.set(K.familyProfiles(), data);
  return { key: k, ...p };
}

/** Soft-delete: the profile disappears from the pickers; its progress keys stay untouched. */
export function removeProfile(store, key, now = Date.now()) {
  const data = load(store);
  const old = data.profiles[key];
  if (!old) return false;
  data.profiles[key] = { ...old, deleted: true, updatedAt: now };
  store.set(K.familyProfiles(), data);
  return true;
}

/**
 * Storage names found in this device's progress keys (from the old app or
 * from a family link) that have no profile yet. Each comes with hints about
 * which modules hold data, so the first-run screen can say "Profil gefunden".
 */
export function detectLegacyProfiles(store) {
  const known = load(store).profiles;
  const found = new Map();
  for (const key of store.list()) {
    const p = profileOf(key);
    if (!p || p === PARENT_KEY || known[p] || !validKey(p)) continue;
    const e = REGISTRY.find(r => r.re.test(key));
    const h = found.get(p) || { key: p, quiz: false, trainer: false, game: false };
    if (e.id.startsWith('quiz')) h.quiz = true;
    else if (e.id.startsWith('gram')) h.trainer = true;
    else if (e.id.startsWith('wr')) h.game = true;
    found.set(p, h);
  }
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** The old device-local extra profiles ([{name, avatar}]) — offered once on the first run, then ignored. */
export function legacyCustomProfiles(store) {
  const list = store.get(K.customProfiles(), []);
  return Array.isArray(list) ? list.filter(p => p && validKey(keyFromName(p.name))).map(p => ({ key: keyFromName(p.name), name: p.name, avatar: p.avatar })) : [];
}

/** The old trainer's remembered profile (it was stored JSON-quoted). */
export function legacyLastProfile(store) {
  const raw = store.getRaw(K.gramLastProfile());
  if (raw === null) return null;
  try { const v = JSON.parse(raw); return typeof v === 'string' ? v : null; } catch { return raw; }
}

// ── the device's current profile ───────────────────────────────────────

export function currentProfileKey(store) {
  const k = store.get(K.appProfile(), null);
  return typeof k === 'string' && getProfile(store, k) ? k : null;
}

export function setCurrentProfile(store, key) {
  if (key === null) { store.remove(K.appProfile()); return; }
  if (!getProfile(store, key)) throw new Error(`Unbekanntes Profil: ${key}`);
  store.set(K.appProfile(), key);
}
