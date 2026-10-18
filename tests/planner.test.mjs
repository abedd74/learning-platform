import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, config, planSession, interleave, testPrepModules, rehearse, recordAnswer, recordSession, streak, streakWasShielded } from '../app/core/planner.js';

const D = '2026-10-18';
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rng = mulberry32(5);
const rec = (b, due) => ({ b, due, s: 1, r: 1, w: 0, k: 1 });
const card = (id, module, topic, r, extra = {}) => ({ id, module, topic, rec: r, ...extra });

function deck({ due = 0, review = 0, fresh = 0, module = 'whales', topic = 't', tags } = {}) {
  const out = [];
  for (let i = 0; i < due; i++) out.push(card(`${module}-due${i}`, module, topic, rec(i % 4, '2026-10-1' + (i % 8)), { tags }));
  for (let i = 0; i < review; i++) out.push(card(`${module}-rev${i}`, module, topic, rec(2 + (i % 3), '2026-10-2' + (i % 9)), { tags }));
  for (let i = 0; i < fresh; i++) out.push(card(`${module}-new${i}`, module, topic, undefined, { tags }));
  return out;
}

test('due cards come first, weakest first; new cards fill up to the session limit', () => {
  const r = planSession({ cards: deck({ due: 4, review: 5, fresh: 10 }), today: D, rng });
  assert.equal(r.cards.length, 10);
  assert.equal(r.counts.due, 4);
  assert.equal(r.counts.new, 5);
  assert.equal(r.counts.filler, 1);
  assert.equal(r.counts.dueTotal, 4);
  assert.ok(r.cards.every(c => ['due', 'new', 'filler'].includes(c.reason)));
});

test('more due cards than a session holds: the weakest boxes are taken, nothing new', () => {
  const cards = deck({ due: 25, fresh: 10 });
  const r = planSession({ cards, today: D, rng });
  assert.equal(r.cards.length, 10);
  assert.equal(r.counts.new, 0);                                  // backlog > throttleDue
  assert.ok(r.cards.every(c => c.reason === 'due'));
  assert.ok(r.cards.every(c => c.rec.b <= 1), 'only boxes 0 and 1 were due enough');
});

test('new cards: per-session and per-day limits, none after the daily goal', () => {
  const cards = deck({ fresh: 20 });
  assert.equal(planSession({ cards, today: D, rng }).counts.new, 5);
  assert.equal(planSession({ cards, today: D, dayRecord: { a: 20, n: 8 }, rng }).counts.new, 2);
  assert.equal(planSession({ cards, today: D, dayRecord: { a: 20, n: 10 }, rng }).counts.new, 0);
  const r = planSession({ cards, today: D, dayRecord: { a: 50, n: 0 }, rng });
  assert.equal(r.counts.new, 0);
  assert.equal(r.goalReached, true);
  assert.equal(r.cards.length, 0);                                // nothing known to fill with
});

test('filler is fair: weakest box first, then earliest due', () => {
  const cards = [card('a', 'm', 't', rec(5, '2026-11-01')), card('b', 'm', 't', rec(2, '2026-11-05')), card('c', 'm', 't', rec(2, '2026-11-02'))];
  const r = planSession({ cards, today: D, cfg: config({ sessionSize: 2 }), rng });
  assert.deepEqual(r.cards.map(c => c.id).sort(), ['b', 'c']);
  assert.ok(r.cards.every(c => c.reason === 'filler'));
});

test('tag caps: at most 4 grammar cards, the rest from other cards', () => {
  const cards = [...deck({ due: 8, module: 'ella', topic: 'akk', tags: ['grammar'] }), ...deck({ due: 8, module: 'ella', topic: 'nouns' })];
  const r = planSession({ cards, today: D, rng });
  assert.equal(r.cards.filter(c => c.tags?.includes('grammar')).length, 4);
  assert.equal(r.cards.length, 10);
});

test('ladders: one new card per item, the highest unlocked level; locked levels stay out', () => {
  const cards = [
    card('BY:pick3', 'states', 'de', undefined, { item: 'BY', level: 0 }),
    card('BY:tap', 'states', 'de', undefined, { item: 'BY', level: 1 }),
    card('BY:type', 'states', 'de', undefined, { item: 'BY', level: 2, unlocked: false }),
    card('HE:pick3', 'states', 'de', undefined, { item: 'HE', level: 0 }),
    card('HE:tap', 'states', 'de', rec(1, '2026-10-10'), { item: 'HE', level: 1 }),
  ];
  const r = planSession({ cards, today: D, rng });
  const ids = r.cards.map(c => c.id);
  assert.ok(ids.includes('HE:tap'));                              // due review
  assert.ok(ids.includes('BY:tap'));                              // highest unlocked new level of BY
  assert.ok(!ids.includes('BY:pick3') && !ids.includes('BY:type'));
  assert.ok(!ids.includes('HE:pick3'), 'an item already in the session gets no second new card');
});

test('test-date mode: that module first, cards due within 3 days pulled forward, more new cards', () => {
  const plan = { tests: { states: '2026-10-25' } };
  assert.deepEqual(testPrepModules(plan, D), { states: 7 });
  assert.deepEqual(testPrepModules({ tests: { states: '2026-11-25', old: '2026-10-01', bad: 'x' } }, D), {});
  const cards = [
    ...deck({ due: 3, module: 'whales' }),
    card('s-soon', 'states', 'de', rec(3, '2026-10-20')),         // due in 2 days → pulled forward
    card('s-later', 'states', 'de', rec(3, '2026-10-23')),        // due in 5 days → not yet
    card('s-due', 'states', 'de', rec(1, '2026-10-17')),
    ...deck({ fresh: 20, module: 'states' }),
  ];
  const r = planSession({ cards, today: D, plan, rng });
  const by = Object.fromEntries(r.cards.map(c => [c.id, c.reason]));
  assert.equal(by['s-soon'], 'test-prep');
  assert.equal(by['s-due'], 'test-prep');
  assert.equal(by['s-later'], undefined);
  assert.equal(r.counts.new, 5);                                  // 5 slots were left after the 5 due/test-prep cards
  assert.equal(r.cards.length, 10);
  assert.deepEqual(r.testPrep, { states: 7 });
  // with nothing due, the doubled new-card limit shows: 10 instead of 5
  const r2 = planSession({ cards: deck({ fresh: 20, module: 'states' }), today: D, plan, rng });
  assert.equal(r2.counts.new, 10);
  assert.equal(planSession({ cards: deck({ fresh: 20, module: 'states' }), today: D, rng }).counts.new, 5);
});

test('interleave avoids three of the same topic in a row when possible', () => {
  const t = (topic, i) => ({ id: `${topic}${i}`, topic });
  const out = interleave([t('a', 1), t('a', 2), t('a', 3), t('b', 1), t('a', 4), t('b', 2)]);
  for (let i = 2; i < out.length; i++) assert.ok(!(out[i].topic === out[i - 1].topic && out[i].topic === out[i - 2].topic), out.map(c => c.id).join(' '));
  assert.deepEqual(interleave([t('a', 1), t('a', 2), t('a', 3)]).map(c => c.id), ['a1', 'a2', 'a3']);
});

test('the session is deterministic for a random source', () => {
  const cards = deck({ due: 6, review: 6, fresh: 6 });
  const a = planSession({ cards, today: D, rng: mulberry32(9) }).cards.map(c => c.id);
  const b = planSession({ cards, today: D, rng: mulberry32(9) }).cards.map(c => c.id);
  assert.deepEqual(a, b);
});

test('rehearse puts a missed card back three cards later, or at the end', () => {
  const q = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  assert.deepEqual(rehearse(q, { id: 'x' }).map(c => c.id), ['a', 'b', 'c', 'x', 'd', 'e']);
  assert.deepEqual(rehearse([{ id: 'a' }], { id: 'x' }).map(c => c.id), ['a', 'x']);
  assert.equal(rehearse(q, { id: 'x' })[3].reason, 'rehearsal');
});

test('day records count answers, first-try rights, new cards, time and sessions', () => {
  let days = recordAnswer(undefined, D, { first: true, isNew: true });
  days = recordAnswer(days, D, { first: false });
  days = recordSession(days, D, 61234.6);
  assert.deepEqual(days, { [D]: { a: 2, c: 1, n: 1, ms: 61235, sess: 1 } });
  const next = recordAnswer(days, '2026-10-19', { first: true });
  assert.equal(next[D].a, 2);
  assert.equal(next['2026-10-19'].a, 1);
});

test('streak as the old trainer: today counts once practised, one missed day per week is bridged', () => {
  const p = (...ds) => Object.fromEntries(ds.map(d => [d, { a: 3, c: 2 }]));
  assert.equal(streak({}, D), 0);
  assert.equal(streak(p('2026-10-18', '2026-10-17', '2026-10-16'), D), 3);
  assert.equal(streak(p('2026-10-17', '2026-10-16'), D), 2);                 // today not yet practised
  assert.equal(streak(p('2026-10-18', '2026-10-16', '2026-10-15'), D), 3);   // 17th bridged by the shield
  assert.ok(streakWasShielded(p('2026-10-18', '2026-10-16'), D));
  assert.ok(!streakWasShielded(p('2026-10-18', '2026-10-17'), D));
  // two gaps within 7 days: the second one ends the streak
  assert.equal(streak(p('2026-10-18', '2026-10-16', '2026-10-14'), D), 2);
  // gaps 8 days apart are both bridged
  const long = p('2026-10-18', '2026-10-16', '2026-10-15', '2026-10-14', '2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-08');
  assert.equal(streak(long, D), 9);
  assert.equal(streak({ [D]: { a: 0 } }, D), 0);
});

test('config merges nested defaults', () => {
  const c = config({ sessionSize: 12, maxPerTag: { map: 6 }, testPrep: { days: 5 } });
  assert.equal(c.sessionSize, 12);
  assert.deepEqual(c.maxPerTag, { grammar: 4, map: 6 });
  assert.deepEqual(c.testPrep, { days: 5, pullForward: 3, newFactor: 2 });
  assert.equal(DEFAULTS.dayGoal, 50);
});
