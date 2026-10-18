// The daily planner: which cards make up the next session, across modules.
//
// Pure. The caller gathers the cards (with their records) and passes the
// day, the day record and the plan; the planner returns an ordered session
// with a reason per card, plus the streak and the day's counters.
//
// Defaults are the old trainer's numbers (DESIGN §4.3): 10 cards a session,
// 50 answers a day, 5 new cards a session, 10 a day, no new cards while more
// than 20 are due, at most 4 grammar cards. Test-date mode: in the days
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
 */
export function planSession({ cards, today, dayRecord = null, plan = null, cfg = DEFAULTS, rng = Math.random }) {
  if (!isDay(today)) throw new TypeError(`planner: not a day: ${today}`);
  const prep = testPrepModules(plan, today, cfg);
  const tagCount = {};
  const chosen = [];
  const usedItems = new Set();
  const canTake = c => {
    for (const t of c.tags || []) if (cfg.maxPerTag[t] !== undefined && (tagCount[t] || 0) >= cfg.maxPerTag[t]) return false;
    return true;
  };
  const take = (c, reason) => {
    for (const t of c.tags || []) tagCount[t] = (tagCount[t] || 0) + 1;
    if (c.item) usedItems.add(c.item);
    chosen.push({ ...c, reason });
  };

  const isPrep = c => c.module in prep;
  const dueLike = c => isDue(c.rec, today) || (isPrep(c) && !isNew(c.rec) && daysUntilDue(c.rec, today) <= cfg.testPrep.pullForward);

  // 1. due cards (and pulled-forward test-prep cards): test-prep first, weakest first, oldest due first
  const due = shuffle(cards.filter(c => dueLike(c)), rng)
    .sort((a, b) => (isPrep(b) - isPrep(a)) || ((a.rec.b || 0) - (b.rec.b || 0)) || (a.rec.due < b.rec.due ? -1 : a.rec.due > b.rec.due ? 1 : 0));
  const dueCount = due.length;
  for (const c of due) {
    if (chosen.length >= cfg.sessionSize) break;
    if (!canTake(c)) continue;
    take(c, isPrep(c) && !isDue(c.rec, today) ? 'test-prep' : (isPrep(c) ? 'test-prep' : 'due'));
  }

  // 2. new cards: not after the daily goal, not while the review backlog is big
  const reached = goalReached(dayRecord, cfg);
  let allowNew = 0;
  if (!reached && dueCount <= cfg.throttleDue) {
    allowNew = Math.min(cfg.newPerSession, Math.max(0, cfg.newPerDay - (dayRecord?.n || 0)));
    if (Object.keys(prep).length) allowNew = Math.min(cfg.newPerSession * cfg.testPrep.newFactor, allowNew * cfg.testPrep.newFactor);
  }
  if (allowNew > 0) {
    // one card per item: the highest unlocked level
    const byItem = new Map();
    for (const c of cards) {
      if (!isNew(c.rec) || c.unlocked === false) continue;
      const k = c.item || c.id;
      const cur = byItem.get(k);
      if (!cur || (c.level || 0) > (cur.level || 0)) byItem.set(k, c);
    }
    const fresh = shuffle([...byItem.values()].filter(c => !usedItems.has(c.item || c.id)), rng)
      .sort((a, b) => (isPrep(b) - isPrep(a)) || ((a.newPriority ?? 0) - (b.newPriority ?? 0)));
    let n = 0;
    for (const c of fresh) {
      if (n >= allowNew || chosen.length >= cfg.sessionSize) break;
      if (!canTake(c)) continue;
      take(c, 'new'); n++;
    }
  }

  // 3. filler: known cards not yet due — fair: shuffled, then weakest box, then earliest due
  if (chosen.length < cfg.sessionSize) {
    const taken = new Set(chosen.map(c => c.id));
    const filler = shuffle(cards.filter(c => !isNew(c.rec) && !taken.has(c.id)), rng)
      .sort((a, b) => ((a.rec.b || 0) - (b.rec.b || 0)) || (a.rec.due < b.rec.due ? -1 : a.rec.due > b.rec.due ? 1 : 0));
    for (const c of filler) {
      if (chosen.length >= cfg.sessionSize) break;
      if (!canTake(c)) continue;
      take(c, 'filler');
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

/** Count one answer into the day record (returns a new record object). */
export function recordAnswer(days, today, { first, isNew = false }) {
  const d = { a: 0, c: 0, n: 0, ...(days?.[today] || {}) };
  d.a += 1;
  if (first) d.c += 1;
  if (isNew) d.n += 1;
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
