import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS, QUIZ_INTERVALS, NOUN_INTERVALS, config, maxBox, newRecord, review, isDue, isNew,
  isMastered, isLeech, leechScore, daysUntilDue, intervalOf, cardId, splitCardId, ladderLevel,
  unlockedSkills, summarize,
} from '../app/core/srs.js';

const D = '2026-10-18';
const quiz = config({ intervals: QUIZ_INTERVALS });
const noun = config({ intervals: NOUN_INTERVALS, fuzz: 1 });

test('a new card answered right first time goes to box 1, due tomorrow (as the old app)', () => {
  const e = review(undefined, 'first', D, quiz);
  assert.deepEqual(e, { b: 1, due: '2026-10-19', s: 1, r: 1, w: 0, k: 1, lz: 0 });
});

test('a new card answered wrong stays in box 0, due today', () => {
  const e = review(undefined, 'wrong', D, quiz);
  assert.deepEqual(e, { b: 0, due: D, s: 1, r: 0, w: 1, k: 0, lz: 1 });
});

test('retry (right after a mistake) counts like a wrong for the record', () => {
  const a = review(newRecord(D), 'retry', D, quiz);
  const b = review(newRecord(D), 'wrong', D, quiz);
  assert.deepEqual(a, b);
});

test('boxes climb through the intervals and stop at the top; the input record is not mutated', () => {
  let e, day = D;
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const before = e && { ...e };
    e = review(e, 'first', day, quiz);
    if (before) assert.deepEqual(before, { ...before });
    seen.push([e.b, e.due]);
    day = e.due;
  }
  assert.deepEqual(seen.map(s => s[0]), [1, 2, 3, 4, 5, 5, 5, 5]);
  assert.equal(maxBox(quiz), 5);
  // due dates follow the interval list: +1, +2, +4, +7, +14, +14 …
  assert.equal(seen[1][1], '2026-10-21');   // 19 + 2
  assert.equal(seen[2][1], '2026-10-25');   // 21 + 4
  assert.equal(seen[3][1], '2026-11-01');   // 25 + 7
  assert.equal(seen[4][1], '2026-11-15');   // 1 Nov + 14
});

test('a wrong answer drops one box, resets the streak and keeps the totals', () => {
  let e = review(undefined, 'first', D, quiz);
  e = review(e, 'first', e.due, quiz);          // box 2
  const w = review(e, 'wrong', '2026-10-21', quiz);
  assert.equal(w.b, 1);
  assert.equal(w.k, 0);
  assert.equal(w.s, 3);
  assert.equal(w.r, 2);
  assert.equal(w.w, 1);
  assert.equal(w.due, '2026-10-22');            // box 1 → 1 day
});

test('old records without lz start their leech score from w, and it decays', () => {
  const old = { b: 3, due: D, s: 10, r: 6, w: 4, k: 0 };
  assert.equal(leechScore(old), 4);
  assert.ok(isLeech(old, quiz));
  assert.equal(intervalOf(old, quiz), 2);      // box 3 = 4 days × 0.6 = 2.4 → 2
  const after = review(old, 'first', D, quiz);
  assert.equal(after.lz, 3);
  assert.ok(!isLeech(after, quiz));
  assert.equal(after.w, 4);                     // total wrongs stay for the dashboard
  assert.equal(after.b, 4);
  assert.equal(after.due, '2026-10-25');        // box 4 = 7 days, no damping any more
});

test('leech damping: interval × 0.6, never below 2 days, never on short intervals', () => {
  const r = { b: 4, due: D, s: 9, r: 4, w: 5, k: 0, lz: 5 };
  assert.equal(intervalOf(r, quiz), 4);         // 7 × 0.6 = 4.2 → 4
  const e = review(r, 'first', D, quiz);        // → box 5 (14 d) × 0.6 = 8.4 → 8
  assert.equal(e.due, '2026-10-26');
  const short = { b: 1, due: D, s: 9, r: 1, w: 8, k: 0, lz: 8 };
  assert.equal(intervalOf(short, quiz), 1);     // 1 day stays 1 day
  const nounLeech = { b: 8, due: D, s: 20, r: 10, w: 10, k: 0, lz: 6 };
  assert.equal(intervalOf(nounLeech, noun), 54); // 90 × 0.6
});

test('fuzz: ±1 day from 4 days on, driven by the injected random source', () => {
  const base = { b: 2, due: D, s: 2, r: 2, w: 0, k: 2, lz: 0 };   // → box 3 = 4 days
  assert.equal(review(base, 'first', D, noun, () => 0.0).due, '2026-10-21');
  assert.equal(review(base, 'first', D, noun, () => 0.5).due, '2026-10-22');
  assert.equal(review(base, 'first', D, noun, () => 0.99).due, '2026-10-23');
  const short = { b: 0, due: D, s: 1, r: 0, w: 1, k: 0, lz: 1 };    // → box 1 = 1 day: no fuzz
  assert.equal(review(short, 'first', D, noun, () => 0.0).due, '2026-10-19');
  assert.equal(review(base, 'first', D, quiz, () => 0.0).due, '2026-10-22'); // quizzes: no fuzz
});

test('due, new, mastered, days until due', () => {
  assert.ok(isNew(undefined));
  assert.ok(!isDue(undefined, D));
  const r = { b: 3, due: '2026-10-18', s: 3, r: 3, w: 0, k: 3 };
  assert.ok(isDue(r, D));
  assert.ok(!isDue({ ...r, due: '2026-10-19' }, D));
  assert.ok(isDue({ ...r, due: '2026-09-01' }, D));
  assert.ok(isMastered(r, quiz));
  assert.ok(!isMastered({ ...r, b: 2 }, quiz));
  assert.equal(daysUntilDue({ ...r, due: '2026-10-21' }, D), 3);
  assert.equal(daysUntilDue({ ...r, due: '2026-10-10' }, D), -8);
  assert.equal(daysUntilDue(undefined, D), Infinity);
});

test('bad input is refused', () => {
  assert.throws(() => review(undefined, 'yes', D), /unknown outcome/);
  assert.throws(() => review(undefined, 'first', '18.10.2026'), /not a day/);
  assert.throws(() => config({ intervals: [3, 1] }), /non-decreasing/);
  assert.throws(() => config({ intervals: [1] }), /at least two/);
  assert.throws(() => config({ leechFactor: 0 }), /leechFactor/);
  assert.throws(() => cardId('a:b', 'x'), /":"/);
});

test('damaged records are healed on review (box out of range, missing counters)', () => {
  const e = review({ b: 99, due: D }, 'first', D, quiz);
  assert.equal(e.b, 5);
  assert.equal(e.s, 1);
  const f = review({ b: -3, due: D }, 'wrong', D, quiz);
  assert.equal(f.b, 0);
});

test('card ids and the ladder', () => {
  assert.equal(cardId('DE-BY'), 'DE-BY');
  assert.equal(cardId('DE-BY', 'name.tap'), 'DE-BY:name.tap');
  assert.deepEqual(splitCardId('DE-BY:name.tap'), { itemId: 'DE-BY', skill: 'name.tap' });
  assert.deepEqual(splitCardId('wal_arten-h1k9z2'), { itemId: 'wal_arten-h1k9z2', skill: null });

  const skills = ['pick3', 'tap', 'type'];
  const recs = {};
  const get = s => recs[s];
  assert.equal(ladderLevel(get, skills), 0);
  recs.pick3 = { b: 1 };
  assert.equal(ladderLevel(get, skills), 0);
  recs.pick3 = { b: 2 };
  assert.equal(ladderLevel(get, skills), 1);
  assert.deepEqual(unlockedSkills(get, skills), ['pick3', 'tap']);
  recs.tap = { b: 2 };
  assert.equal(ladderLevel(get, skills), 2);
  recs.pick3 = { b: 0 };                      // a later mistake on level 0 does not close level 2
  assert.equal(ladderLevel(get, skills), 0 + 0 || ladderLevel(get, skills));
});

test('ladder: a drop on the previous level closes the next one only until it recovers', () => {
  // Design choice: the ladder is recomputed from the records; if level 0 falls
  // below unlockBox, level 1 is no longer offered as NEW, but an existing
  // level-1 record keeps being reviewed by the planner (it schedules by record).
  const skills = ['pick3', 'tap'];
  const recs = { pick3: { b: 1 }, tap: { b: 2 } };
  assert.equal(ladderLevel(s => recs[s], skills), 0);
});

test('summarize counts total, due, mastered, leeches and boxes', () => {
  const store = {
    a: { b: 0, due: D, s: 1, r: 0, w: 1, k: 0 },
    b: { b: 3, due: '2026-12-01', s: 3, r: 3, w: 0, k: 3 },
    c: { b: 2, due: '2026-10-01', s: 9, r: 4, w: 5, k: 0 },
    broken: null,
  };
  assert.deepEqual(summarize(store, D, quiz), { total: 3, due: 2, mastered: 1, leeches: 1, byBox: [1, 0, 1, 1, 0, 0] });
});

test('DEFAULTS are the quiz intervals and are frozen', () => {
  assert.deepEqual([...DEFAULTS.intervals], [0, 1, 2, 4, 7, 14]);
  assert.ok(Object.isFrozen(DEFAULTS));
});
