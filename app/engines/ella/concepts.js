// The concept lifecycle of Deutsch mit Ella, ported from the old trainer:
// Lernpfad (units) → Festigen (practice days) → Meister-Check → Gold with
// refreshers. State per concept lives in gram_path_<P>:
//   { unit, passed:{n: ts}, fest:{day: n}, mc:{tries, passed, nextTry}, gBox, gDue }
// Pure over the store; the day is passed in.

import { keys as K } from '../../core/storage.js';
import { addDays } from '../../core/time.js';

export const FEST_MIN_DAYS = 3;
export const MC_SIZE = 10;
export const MC_PASS = 8;
export const MC_RETRY_DAYS = 2;
export const MC_NUDGE_DAYS = 2;
export const GOLD_INTERVALS = Object.freeze([7, 14, 30, 60]);
export const PATH_PASS_RETRIES = 1;
export const PATH_PASS_RETRIES_FINAL = 2;

export const CONCEPTS = Object.freeze({
  akk:   { name: 'Akkusativ', em: '✍️', drill: 'akk', detective: 'Akkusativ-Detektivin', next: 'dat' },
  dat:   { name: 'Dativ', em: '✉️', drill: 'dat', detective: 'Dativ-Detektivin', requires: 'akk' },
  nomen: { name: 'Nomen-Bausteine', em: '🧩', detective: 'Baustein-Detektivin', live: 'nomen',
           newNote: '✨ Neu! Entdecke, wie -nis, -schaft und -tum dir den Artikel verraten.' },
});
export const CONCEPT_KEYS = Object.freeze(Object.keys(CONCEPTS));

export function createConcepts({ store, profile, units, today, parent = false }) {
  // units: { akk: [...], dat: [...], nomen: [...] } from the noun pack
  const key = K.gramPath(profile);
  const load = () => store.get(key, {}) || {};
  const save = p => store.set(key, p);
  const unitsOf = k => units[k] || [];

  function state(k) { return load()[k] || { unit: 1, passed: {} }; }
  function done(k) { return state(k).unit > unitsOf(k).length; }
  function savePass(k, unitN) {
    const p = load();
    const st = p[k] || { unit: 1, passed: {} };
    st.passed = st.passed || {};
    st.passed[unitN] = Date.now();
    st.unit = Math.max(st.unit || 1, unitN + 1);
    p[k] = st; save(p);
  }
  function gold(k) { const st = state(k); return !!(st.mc && st.mc.passed); }
  function inFest(k) { return done(k) && !gold(k); }
  function festDays(k) { return Object.keys(state(k).fest || {}).length; }
  function stampFestDay(k) {
    const p = load(); const st = p[k]; if (!st) return;
    st.fest = st.fest || {};
    st.fest[today()] = (st.fest[today()] || 0) + 1;
    save(p);
  }
  function mcReady(k) {
    if (!inFest(k)) return false;
    if (!parent && festDays(k) < FEST_MIN_DAYS) return false;
    const st = state(k);
    if (st.mc && st.mc.nextTry && st.mc.nextTry > today()) return false;
    return true;
  }
  function pathOpen(k) {
    if (parent) return true;
    const req = CONCEPTS[k].requires;
    return !req || gold(req);
  }
  function mcReadySince(k) {
    const st = state(k);
    if (st.mc && st.mc.nextTry) return st.mc.nextTry;
    const fest = Object.keys(st.fest || {}).sort();
    return fest[FEST_MIN_DAYS - 1] || today();
  }
  function mcOverdue(k) {
    if (parent || !mcReady(k)) return false;
    return addDays(mcReadySince(k), MC_NUDGE_DAYS) <= today();
  }
  function due(k) {
    const st = state(k);
    return gold(k) && (!st.gDue || st.gDue <= today());
  }
  function bumpGold(k, ok) {
    const p = load(); const st = p[k]; if (!st) return;
    st.gBox = ok ? Math.min((st.gBox ?? -1) + 1, GOLD_INTERVALS.length - 1) : 0;
    st.gDue = addDays(today(), GOLD_INTERVALS[st.gBox]);
    save(p);
  }
  /** Record a Meister-Check result. Returns {passed, need}. */
  function recordMc(k, firstTry, total) {
    const need = Math.ceil(total * (MC_PASS / MC_SIZE));
    const passed = firstTry >= need;
    const p = load();
    const st = p[k] || (p[k] = { unit: 1, passed: {} });
    st.mc = st.mc || { tries: 0 };
    st.mc.tries++;
    if (passed) { st.mc.passed = Date.now(); st.gBox = 0; st.gDue = addDays(today(), GOLD_INTERVALS[0]); }
    else st.mc.nextTry = addDays(today(), MC_RETRY_DAYS);
    save(p);
    return { passed, need };
  }
  /** Record a Lernpfad unit round. Returns {passed, nowDone}. */
  function recordPath(k, unitN, { wrong, retries }) {
    const last = unitN === unitsOf(k).length;
    const allowed = last ? PATH_PASS_RETRIES_FINAL : PATH_PASS_RETRIES;
    const passed = wrong === 0 && retries <= allowed;
    if (passed) savePass(k, unitN);
    return { passed, nowDone: passed && done(k) };
  }
  /** After an ordinary session: Festigen days and the Gold refresher. `touched`: {k: [outcome]} */
  function afterSession(touched) {
    for (const [k, outcomes] of Object.entries(touched)) {
      if (inFest(k)) stampFestDay(k);
      else if (gold(k)) {
        const allRight = outcomes.every(o => o === 'first');
        if (due(k)) bumpGold(k, allRight);
        else if (!allRight) bumpGold(k, false);
      }
    }
  }
  /** Which unit to show next for a course (1-based, clamped). */
  function nextUnit(k) { return Math.min(state(k).unit || 1, unitsOf(k).length); }

  return { state, done, savePass, gold, inFest, festDays, stampFestDay, mcReady, pathOpen, mcReadySince, mcOverdue, due, bumpGold, recordMc, recordPath, afterSession, nextUnit, unitsOf };
}
