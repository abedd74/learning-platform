// The spaced-repetition scheduler. One implementation for every module.
//
// Transparent boxes (Leitner) with growing intervals, as in the old app:
// right on the first try → one box up, wrong → one box down; the box decides
// in how many days the card comes back. Each module brings its own interval
// list, so the quizzes keep [0,1,2,4,7,14] and the nouns keep
// [0,1,2,4,8,16,32,64,90] — no existing due date changes (DESIGN §4.2).
//
// Record shape (unchanged from the old app, two optional additions):
//   { b, due, s, r, w, k, lz?, v? }
//   b  box 0..n        due 'YYYY-MM-DD'      s times seen
//   r  first-try rights  w wrongs (total)    k current first-try streak
//   lz leech score: recent wrongs, +1 per wrong, −1 per first-try right.
//      Old records have none; they start from w (the old rule used w).
//
// A card is item × skill. Single-skill items (a quiz question, a noun's
// gender) use the item id alone; multi-skill items (a region on a map) use
// '<itemId>:<skill>'. The ladder (pick → tap → type) is a list of skills;
// the next skill unlocks when the previous one's record reaches unlockBox.
//
// Everything is pure. The day and the random source are passed in.

import { addDays, diffDays, isDay } from './time.js';

export const QUIZ_INTERVALS = Object.freeze([0, 1, 2, 4, 7, 14]);
export const NOUN_INTERVALS = Object.freeze([0, 1, 2, 4, 8, 16, 32, 64, 90]);

export const DEFAULTS = Object.freeze({
  intervals: QUIZ_INTERVALS,
  leechAfter: 4,      // leech score at which the interval is shortened
  leechFactor: 0.6,   // … to this share of the normal interval
  leechMinDays: 2,    // … but never below this
  fuzz: 0,            // 1 = ±1 day on long intervals (the trainer does this)
  fuzzFrom: 4,        // apply fuzz from this many days on
  masteredBox: 3,     // "gemeistert" from this box on
  unlockBox: 2,       // next skill of the ladder unlocks at this box
});

export const OUTCOMES = Object.freeze(['first', 'retry', 'wrong']);

/** Build a config: DEFAULTS overridden by `o`, checked. */
export function config(o = {}) {
  const c = { ...DEFAULTS, ...o };
  if (!Array.isArray(c.intervals) || c.intervals.length < 2 || c.intervals.some((d, i) => !Number.isInteger(d) || d < 0 || (i && d < c.intervals[i - 1]))) {
    throw new TypeError('srs: intervals must be a non-decreasing list of whole days, at least two long');
  }
  for (const k of ['leechAfter', 'leechMinDays', 'fuzzFrom', 'masteredBox', 'unlockBox']) {
    if (!Number.isInteger(c[k]) || c[k] < 0) throw new TypeError(`srs: ${k} must be a whole number ≥ 0`);
  }
  if (!(c.leechFactor > 0 && c.leechFactor <= 1)) throw new TypeError('srs: leechFactor must be in (0, 1]');
  return Object.freeze(c);
}

export function maxBox(cfg = DEFAULTS) { return cfg.intervals.length - 1; }

export function newRecord(today) {
  if (!isDay(today)) throw new TypeError(`srs: not a day: ${today}`);
  return { b: 0, due: today, s: 0, r: 0, w: 0, k: 0 };
}

export function leechScore(rec) {
  if (!rec) return 0;
  return Number.isFinite(rec.lz) ? rec.lz : (rec.w || 0);
}

export function isLeech(rec, cfg = DEFAULTS) { return leechScore(rec) >= cfg.leechAfter; }

export function isNew(rec) { return !rec; }

export function isDue(rec, today) { return !!rec && typeof rec.due === 'string' && rec.due <= today; }

export function isMastered(rec, cfg = DEFAULTS) { return !!rec && rec.b >= cfg.masteredBox; }

/** Days until the card is due (negative = overdue). Infinity for a new card. */
export function daysUntilDue(rec, today) {
  if (!rec) return Infinity;
  return isDay(rec.due) ? diffDays(today, rec.due) : 0;
}

/**
 * Apply one answer. Returns a NEW record; the input is not changed.
 *   outcome  'first' (right on the first try) | 'retry' (right after a mistake) | 'wrong'
 *   today    'YYYY-MM-DD'
 *   rng      () → [0,1), only used when cfg.fuzz is on
 */
export function review(rec, outcome, today, cfg = DEFAULTS, rng = () => 0.5) {
  if (!OUTCOMES.includes(outcome)) throw new TypeError(`srs: unknown outcome "${outcome}"`);
  if (!isDay(today)) throw new TypeError(`srs: not a day: ${today}`);
  const e = rec ? { ...rec } : newRecord(today);
  const top = maxBox(cfg);
  const lz = leechScore(e);
  e.b = Math.min(Math.max(Number.isInteger(e.b) ? e.b : 0, 0), top);
  e.s = (e.s || 0) + 1;
  if (outcome === 'first') {
    e.r = (e.r || 0) + 1;
    e.k = (e.k || 0) + 1;
    e.b = Math.min(top, e.b + 1);
    e.lz = Math.max(0, lz - 1);
  } else {
    e.w = (e.w || 0) + 1;
    e.k = 0;
    e.b = Math.max(0, e.b - 1);
    e.lz = lz + 1;
  }
  let iv = cfg.intervals[e.b];
  // Leech damping: a chronically hard card comes back sooner (and the
  // planner shows its explanation first).
  if (isLeech(e, cfg) && iv > cfg.leechMinDays) iv = Math.max(cfg.leechMinDays, Math.round(iv * cfg.leechFactor));
  // Fuzz: cards learned together should not always return as a block.
  if (cfg.fuzz && iv >= cfg.fuzzFrom) iv += Math.floor(rng() * 3) - 1;
  e.due = addDays(today, Math.max(0, iv));
  return e;
}

/** The scheduled interval (days) a record is on, after leech damping, without fuzz. */
export function intervalOf(rec, cfg = DEFAULTS) {
  if (!rec) return 0;
  let iv = cfg.intervals[Math.min(Math.max(rec.b || 0, 0), maxBox(cfg))];
  if (isLeech(rec, cfg) && iv > cfg.leechMinDays) iv = Math.max(cfg.leechMinDays, Math.round(iv * cfg.leechFactor));
  return iv;
}

// ── cards and the ladder ────────────────────────────────────────────────

export function cardId(itemId, skill = null) {
  if (typeof itemId !== 'string' || !itemId) throw new TypeError('srs: itemId must be a non-empty string');
  if (itemId.includes(':')) throw new TypeError(`srs: itemId must not contain ":" (${itemId})`);
  return skill ? `${itemId}:${skill}` : itemId;
}

export function splitCardId(id) {
  const i = id.indexOf(':');
  return i === -1 ? { itemId: id, skill: null } : { itemId: id.slice(0, i), skill: id.slice(i + 1) };
}

/**
 * Highest unlocked skill index of an item on a ladder.
 *   getRecord(skill) → record | undefined
 *   skills           ordered list, e.g. ['name.pick3', 'name.tap', 'name.type']
 * Level 0 is always open; level i opens when level i-1 has box ≥ unlockBox.
 * A mistake on a higher level never closes it again.
 */
export function ladderLevel(getRecord, skills, cfg = DEFAULTS) {
  let level = 0;
  for (let i = 1; i < skills.length; i++) {
    const prev = getRecord(skills[i - 1]);
    if (prev && prev.b >= cfg.unlockBox) level = i; else break;
  }
  return level;
}

export function unlockedSkills(getRecord, skills, cfg = DEFAULTS) {
  return skills.slice(0, ladderLevel(getRecord, skills, cfg) + 1);
}

/** Summary counts over a store {cardId: record}. */
export function summarize(store, today, cfg = DEFAULTS) {
  const out = { total: 0, due: 0, mastered: 0, leeches: 0, byBox: Array(cfg.intervals.length).fill(0) };
  for (const rec of Object.values(store || {})) {
    if (!rec || typeof rec !== 'object') continue;
    out.total++;
    if (isDue(rec, today)) out.due++;
    if (isMastered(rec, cfg)) out.mastered++;
    if (isLeech(rec, cfg)) out.leeches++;
    out.byBox[Math.min(Math.max(rec.b || 0, 0), maxBox(cfg))]++;
  }
  return out;
}
