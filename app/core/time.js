// Dates for the learning core. A "day" is a 'YYYY-MM-DD' string in the
// family's time zone (Europe/Berlin), so the day flips at local midnight —
// the old app used UTC, which flipped at 01:00/02:00. Existing records keep
// their UTC day strings; the one-day difference needs no conversion.
//
// Every function is pure: the clock is passed in, never read from Date.now().

export const ZONE = 'Europe/Berlin';

const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Calendar day of `now` (a Date or ms) in the family's zone, as 'YYYY-MM-DD'. */
export function today(now = new Date()) {
  const d = now instanceof Date ? now : new Date(now);
  // en-CA gives YYYY-MM-DD; some engines add U+200E marks — strip anything else.
  return fmt.format(d).replace(/[^0-9-]/g, '');
}

export function isDay(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(toUtcMs(s));
}

function toUtcMs(day) {
  const [y, m, d] = day.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  // reject 2026-02-30 and the like
  return (back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d) ? ms : NaN;
}

function fromUtcMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' plus n days (n may be negative). */
export function addDays(day, n) {
  if (!isDay(day)) throw new TypeError(`addDays: not a day: ${day}`);
  return fromUtcMs(toUtcMs(day) + n * 86400000);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a, b) {
  if (!isDay(a) || !isDay(b)) throw new TypeError(`diffDays: not days: ${a}, ${b}`);
  return Math.round((toUtcMs(b) - toUtcMs(a)) / 86400000);
}

/** Compare two days: -1, 0, 1. Day strings compare correctly as text. */
export function compareDays(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Parse the old app's round-history dates, written with
 * toLocaleDateString('de-DE'): '5.3.2026' or '05.03.2026'. Returns
 * 'YYYY-MM-DD' or null.
 */
export function parseLegacyDate(s) {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*$/.exec(s || '');
  if (!m) return isDay(s) ? s : null;
  const day = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isDay(day) ? day : null;
}

/** The old app's display format for a day: 'D.M.YYYY' (kept for the history key). */
export function toLegacyDate(day) {
  if (!isDay(day)) throw new TypeError(`toLegacyDate: not a day: ${day}`);
  const [y, m, d] = day.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
}

/** Weekday 0 = Monday … 6 = Sunday, of a 'YYYY-MM-DD'. */
export function weekday(day) {
  return (new Date(toUtcMs(day)).getUTCDay() + 6) % 7;
}
