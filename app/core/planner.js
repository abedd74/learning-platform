// The daily planner: which cards make up the next session, across modules.
//
// Pure. The caller gathers the cards (with their records) and passes the
// day, the day record and the plan; the planner returns an ordered session
// with a reason per card, plus the streak and the day's counters.
//
// Defaults are the old trainer's numbers (DESIGN §4.3): 10 cards a session,
// 50 answers a day, 5 new cards a session (reserved first), 10 a day, no new
// cards while more than 20 are due, at most 4 grammar cards. Test-date mode: in the days
// before a known test, that module's cards come first, cards due within a
// few days are pulled forward and its new-card limit grows.

import { isDue, isNew, daysUntilDue } from './srs.js';
import { addDays, diffDays, isDay } from './time.js';

export const DEFAULTS = Object.freeze({
  sessionSize: 10,
  dayGoal: 50,
  newPerSession: 5,
  newPerDay: 10,
  throttleDue: 20,
  maxPerTag: Object.freeze({ grammar: 4 }),
  rehearsalGap: 3,
  testPrep: Object.freeze({ days: 10, pullForward: 3, newFactor: 2 }),
  shieldDays: 7,
});

export function config(o = {}) {
  return Object.freeze({ ...DEFAULTS, ...o, maxPerTag: { ...DEFAULTS.maxPerTag, ...(o.maxPerTag || {}) }, testPrep: { ...DEFAULTS.testPrep, ...(o.testPrep || {}) } });
}

/**
 * A card as the planner sees it:
 *   { id, module, topic, rec, tags?, item?, level?, unlocked? }
 *   rec      the SRS record or undefined (new)
 *   item     for ladders: the item id shared by its skill cards; level = skill index;
 *            unlocked=false keeps a new card out of the session
 */

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** Spread cards so that the same topic does not come three times in a row when it can be avoided. */
export function interleave(cards) {
  const out = cards.slice();
  for (let i = 2; i < out.length; i++) {
    if (out[i].topic !== out[i - 1].topic || out[i].topic !== out[i - 2].topic) continue;
    const j = out.findIndex((c, k) => k > i && c.topic !== out[i].topic);
    if (j !== -1) { const t = out[i]; out[i] = out[j]; out[j] = t; }
  }
  return out;
}

/** Modules whose test date lies within the preparation window: {module: daysLeft}. */
export function testPrepModules(plan, today, cfg = DEFAULTS) {
  const out = {};
  for (const [m, day] of Object.entries(plan?.tests || {})) {
    if (!isDay(day)) continue;
    const left = diffDays(today, day);
    if (left >= 0 && left <= cfg.testPrep.days) out[m] = left;
  }
  return out;
}

export function goalReached(dayRecord, cfg = DEFAULTS) {
  return (dayRecord?.a || 0) >= cfg.dayGoal;
}

/**
 * Assemble a session.
 * Returns { cards: [{...card, reason}], counts, goalReached, testPrep }.
 * Reasons: 'due' | 'test-prep' | 'new' | 'filler'.
 *
 * Two compositions, both taken from the old app (review 2026-11-15):
 *   daily training (default) — the old trainer: up to `newPerSession` new
 *     cards are RESERVED first (so a child with a steady pile of reviews
 *     still meets new words every round), then due cards weakest first,
 *     then known cards as filler; a round that is still short is topped up
 *     with new cards, whatever the limits say (a brand-new profile gets a
 *     full round). No new cards after the day's goal, above the daily limit
 *     per module, or while more than `throttleDue` cards are due.
 *   free practice (`free: true`) — the old quiz, when the child picks a
 *     module or a topic herself: due cards weakest first, then every unseen
 *     card, then the ones not seen for longest. No limits.
 */
export function planSession({ cards, today, dayRecord = null, plan = null, cfg = DEFAULTS, rng = Math.random, free = false }) {
  if (!isDay(today)) throw new TypeError(`planner: not a day: ${today}`);
  const prep = testPrepModules(plan, today, cfg);
  const tagCount = {};
  const chosen = [];
  const usedItems = new Set();
  const full = () => chosen.length >= cfg.sessionSize;
  const canTake = c => {
    if (c.item && usedItems.has(c.item)) return false;      // one card per item in a session (ladders)
    for (const t of c.tags || []) if (cfg.maxPerTag[t] !== undefined && (tagCount[t] || 0) >= cfg.maxPerTag[t]) return false;
    return true;
  };
  const take = (c, reason) => {
    for (const t of c.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
    if (c.item) usedItems.add(c.item);
    chosen.push({ ...c, reason });
  };
  const byDue = (a, b) => (a.rec.due < b.rec.due ? -1 : a.rec.due > b.rec.due ? 1 : 0);

  const isPrep = c => c.module in prep;
  const dueLike = c => isDue(c.rec, today) || (isPrep(c) && !isNew(c.rec) && daysUntilDue(c.rec, today) <= cfg.testPrep.pullForward);

  // due cards (and pulled-forward test-prep cards): test-prep first, weakest first, oldest due first
  const due = shuffle(cards.filter(c => dueLike(c)), rng)
    .sort((a, b) => (isPrep(b) - isPrep(a)) || ((a.rec.b || 0) - (b.rec.b || 0)) || byDue(a, b));
  const dueCount = due.length;
  const dueItems = new Set(due.map(c => c.item).filter(Boolean));
  const takeDue = limit => {
    for (const c of due) {
      if (chosen.length >= limit) break;
      if (!canTake(c)) continue;
      take(c, isPrep(c) ? 'test-prep' : 'due');
    }
  };

  // new cards: one per item (the highest unlocked level), never for an item that has a card due;
  // test-prep modules first, then the modules take turns, each in its own order (newPriority)
  const freshList = () => {
    const byItem = new Map();
    for (const c of cards) {
      if (!isNew(c.rec) || c.unlocked === false) continue;
      if (c.item && (dueItems.has(c.item) || usedItems.has(c.item))) continue;
      const k = c.item || c.id;
      const cur = byItem.get(k);
      if (!cur || (c.level || 0) > (cur.level || 0)) byItem.set(k, c);
    }
    const perModule = new Map();
    for (const c of shuffle([...byItem.values()], rng)) { if (!perModule.has(c.module)) perModule.set(c.module, []); perModule.get(c.module).push(c); }
    for (const list of perModule.values()) list.sort((a, b) => (a.newPriority ?? 0) - (b.newPriority ?? 0));
    const turn = mods => { const out = []; for (let i = 0; mods.some(m => i < perModule.get(m).length); i++) for (const m of mods) if (i < perModule.get(m).length) out.push(perModule.get(m)[i]); return out; };
    const mods = [...perModule.keys()];
    return [...turn(mods.filter(m => m in prep)), ...turn(mods.filter(m => !(m in prep)))];
  };
  const taken = () => new Set(chosen.map(c => c.id));
  const reached = goalReached(dayRecord, cfg);

  if (free) {
    takeDue(cfg.sessionSize);
    for (const c of shuffle(freshList(), rng)) { if (full()) break; if (canTake(c)) take(c, 'new'); }
    if (!full()) {
      const have = taken();
      for (const c of shuffle(cards.filter(c => !isNew(c.rec) && !have.has(c.id)), rng).sort(byDue)) { if (full()) break; if (canTake(c)) take(c, 'filler'); }
    }
  } else {
    const newToday = m => (dayRecord?.by?.[m]?.n) ?? 0;
    let allowNew = 0;
    if (!reached && dueCount <= cfg.throttleDue) allowNew = cfg.newPerSession * (Object.keys(prep).length ? cfg.testPrep.newFactor : 1);
    const perModuleLeft = m => Math.max(0, cfg.newPerDay * (m in prep ? cfg.testPrep.newFactor : 1) - newToday(m));
    const usedPerModule = {};
    let n = 0;
    const takeNew = limit => {
      if (n >= limit) return;
      for (const c of freshList()) {
        if (n >= limit || full()) break;
        if (taken().has(c.id) || !canTake(c)) continue;
        if ((usedPerModule[c.module] || 0) >= perModuleLeft(c.module)) continue;
        take(c, 'new'); n++; usedPerModule[c.module] = (usedPerModule[c.module] || 0) + 1;
      }
    };
    // 1. the reserved new cards (the old trainer's NEW_PER_SESSION)
    takeNew(Math.min(allowNew, cfg.newPerSession));
    // 2. due cards
    takeDue(cfg.sessionSize);
    // 3. before a test the allowance is bigger: more new cards when there is room
    takeNew(allowNew);
    // 4. filler: known cards not yet due — fair: shuffled, then weakest box, then earliest due
    if (!full()) {
      const have = taken();
      const filler = shuffle(cards.filter(c => !isNew(c.rec) && !have.has(c.id)), rng).sort((a, b) => ((a.rec.b || 0) - (b.rec.b || 0)) || byDue(a, b));
      for (const c of filler) { if (full()) break; if (canTake(c)) take(c, 'filler'); }
    }
    // 5. still short (a new profile, or few known cards): fill the round with new cards, limits or not
    if (!full()) {
      const have = taken();
      for (const c of freshList()) { if (full()) break; if (!have.has(c.id) && canTake(c)) take(c, 'new'); }
    }
  }
  const session = interleave(shuffle(chosen, rng));
  const counts = { due: 0, 'test-prep': 0, new: 0, filler: 0, dueTotal: dueCount };
  for (const c of session) counts[c.reason]++;
  return { cards: session, counts, goalReached: reached, testPrep: prep };
}

/** Put a missed card back into the remaining queue, `gap` cards later (or at the end). */
export function rehearse(queue, card, gap = DEFAULTS.rehearsalGap) {
  const out = queue.slice();
  out.splice(Math.min(gap, out.length), 0, { ...card, reason: 'rehearsal' });
  return out;
}

// ── day records: {day: {a, c, n, ms, sess}} ─────────────────────────────

/** Count one answer into the day record (returns a new record object). `module` keeps per-module counts in `by`. */
export function recordAnswer(days, today, { first, isNew = false, module = null }) {
  const d = { a: 0, c: 0, n: 0, ...(days?.[today] || {}) };
  d.a += 1;
  if (first) d.c += 1;
  if (isNew) d.n += 1;
  if (module) {
    const by = { ...(d.by || {}) };
    const m = { a: 0, c: 0, n: 0, ...(by[module] || {}) };
    m.a += 1; if (first) m.c += 1; if (isNew) m.n += 1;
    by[module] = m; d.by = by;
  }
  return { ...(days || {}), [today]: d };
}

/** Add a finished session's duration. */
export function recordSession(days, today, ms) {
  const d = { a: 0, c: 0, n: 0, ...(days?.[today] || {}) };
  d.ms = (d.ms || 0) + Math.max(0, Math.round(ms));
  d.sess = (d.sess || 0) + 1;
  return { ...(days || {}), [today]: d };
}

const practised = (days, d) => !!days?.[d] && (days[d].a || 0) > 0;

/**
 * Streak in days, as the old trainer counted it: today counts as soon as
 * practised; at most ONE missed day per `shieldDays` is bridged silently.
 */
export function streak(days, today, cfg = DEFAULTS) {
  let n = 0, d = today, lastShield = null;
  if (!practised(days, d)) d = addDays(d, -1);
  for (let guard = 0; guard < 3700; guard++) {
    if (practised(days, d)) n++;
    else {
      if (n === 0) break;
      if (lastShield && diffDays(d, lastShield) < cfg.shieldDays) break;
      lastShield = d;
    }
    d = addDays(d, -1);
  }
  return n;
}

/** Was yesterday bridged by the shield? */
export function streakWasShielded(days, today, cfg = DEFAULTS) {
  return streak(days, today, cfg) > 0 && !practised(days, addDays(today, -1));
}
