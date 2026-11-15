import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, keys as K } from '../app/core/storage.js';
import { createSession } from '../app/core/session.js';

const P = 'Testkind';
const D = '2026-10-18';
const q = (id, correct = 1) => ({ id, type: 'choice', topic: 'arten', module: 'whales', prompt: { de: '?' }, hint: { de: 'h' }, answer: { options: [{ de: 'a' }, { de: 'b' }], correct } });
const item = (id, rec) => ({ card: { id, module: 'whales', topic: 'arten', store: 'quizSrs', rec, reason: rec ? 'due' : 'new' }, question: q(id) });

function harness(items, local = {}) {
  const store = createStore({ backend: memoryBackend(local), log: { warn() {} } });
  let t = 1_000_000;
  const s = createSession({ items, profile: P, store, today: D, now: () => (t += 1000), module: 'whales', mode: 'arten' });
  return { store, s };
}

test('right first time: record climbs, stats and day counters move, points 2/2', () => {
  const { store, s } = harness([item('wal_1')]);
  const r = s.answer(1);
  assert.deepEqual({ ok: r.ok, final: r.final, outcome: r.outcome }, { ok: true, final: true, outcome: 'first' });
  const rec = store.get(K.quizSrs(P)).wal_1;
  assert.equal(rec.b, 1);
  assert.equal(rec.due, '2026-10-19');
  assert.deepEqual(store.get(K.quizStats(P)).wal_1, { shown: 1, correct: 1, wrong: 0, lastSeen: '18.10.2026' });
  assert.deepEqual(store.get(K.planDays(P))[D], { a: 1, c: 1, n: 1, by: { whales: { a: 1, c: 1, n: 1 } } });
  assert.equal(s.next(), false);
  const sum = s.finish();
  assert.equal(sum.pct, 1);
  assert.equal(sum.newCount, 1);
  const hist = store.get(K.quizHistory(P));
  assert.equal(hist.length, 1);
  assert.deepEqual(hist[0].topics, { arten: { pts: 2, max: 2 } });
  assert.equal(hist[0].date, '18.10.2026');
  assert.match(hist[0].time, /^\d\d:\d\d$/);
  assert.equal(hist[0].module, 'whales');
  assert.equal(hist[0].mode, 'arten');
  assert.equal(hist[0].pct, 100, 'a whole number 0–100, as the old app wrote it');
  assert.equal(store.get(K.planDays(P))[D].sess, 1);
});

test('the round history keeps the old app\'s shape next to its old entries', () => {
  const old = { date: '5.3.2026', time: '17:05', mode: 'mixed', pct: 85, module: 'whales', topics: { arten: { pts: 17, max: 20 } } };
  const { store, s } = harness([item('wal_1'), item('wal_2')], { [K.quizHistory(P)]: JSON.stringify([old]) });
  s.answer(1); s.next(); s.answer(0); s.answer(1); s.next();
  s.answer(1); s.next();                                       // the re-asked card
  s.finish();
  const hist = store.get(K.quizHistory(P));
  assert.deepEqual(hist[0], old);
  assert.deepEqual(Object.keys(hist[1]).sort(), Object.keys(old).sort());
  assert.equal(hist[1].pct, 75);
  assert.ok(Number.isInteger(hist[1].pct));
});

test('the history gets finished quiz rounds only: not a round left early, not a mixed or trainer round', () => {
  const left = harness([item('wal_1'), item('wal_2')]);
  left.s.answer(1);
  left.s.finish();                                             // quit after one card
  assert.equal(left.store.has(K.quizHistory(P)), false);
  assert.equal(left.store.get(K.planDays(P))[D].sess, 1, 'the practice time still counts');
  const noun = { card: { id: 'Apfel', module: 'nouns', topic: 'gender', store: 'gramSrs' }, question: { type: 'gender', noun: { de: 'Apfel', g: 'der' } } };
  const mixed = harness([item('wal_1'), noun]);
  mixed.s.answer(1); mixed.s.next(); mixed.s.answer('der'); mixed.s.next();
  mixed.s.finish();
  assert.equal(mixed.store.has(K.quizHistory(P)), false);
});

test('a second tap on a decided card changes nothing', () => {
  const { store, s } = harness([item('wal_1', { b: 4, due: D, s: 4, r: 4, w: 0, k: 4 })], { [K.quizSrs(P)]: JSON.stringify({ wal_1: { b: 4, due: D, s: 4, r: 4, w: 0, k: 4 } }) });
  const r1 = s.answer(1);
  const r2 = s.answer(0);
  assert.deepEqual(r2, r1);
  assert.equal(store.get(K.quizSrs(P)).wal_1.b, 5);
  assert.equal(store.get(K.planDays(P))[D].a, 1);
});

test('"new" comes from the stored record, not from the card\'s snapshot (a second round with the same cards)', () => {
  const store = createStore({ backend: memoryBackend(), log: { warn() {} } });
  const cards = [item('wal_1'), item('wal_2')];                // both new when the list was made
  for (let round = 0; round < 2; round++) {
    const s = createSession({ items: cards, profile: P, store, today: D, module: 'whales' });
    s.answer(1); s.next(); s.answer(1); s.next(); s.finish();
  }
  assert.equal(store.get(K.planDays(P))[D].n, 2, 'two new cards, not four');
  assert.equal(store.get(K.quizSrs(P)).wal_1.s, 2);
});

test('an item without a record (a grammar sentence) is an answer, never a new card', () => {
  const store = createStore({ backend: memoryBackend(), log: { warn() {} } });
  const seen = [];
  const sentence = { card: { id: 'ella:akk:x', module: 'nouns', topic: 'akk', store: null, tags: ['grammar'], concept: 'akk', onAnswer: e => seen.push(e) }, question: { type: 'pmcq', opts: ['den', 'der'], correct: 'den' } };
  const s = createSession({ items: [sentence], profile: P, store, today: D, module: 'nouns' });
  s.answer('den'); s.next();
  const sum = s.finish();
  assert.equal(sum.newCount, 0);
  assert.deepEqual(store.get(K.planDays(P))[D].by, { nouns: { a: 1, c: 1, n: 0 } });
  assert.equal(store.get(K.gramDays(P))[D].n, undefined);
  assert.equal(store.has(K.gramSrs(P)), false);
  assert.deepEqual(seen.map(e => [e.ok, e.final, e.rehearsal]), [[true, true, false]]);
});

test('the noun trainer\'s ±1 day reaches the due date (the random source is passed on)', () => {
  const cfg = { intervals: [0, 1, 2, 4, 8, 16, 32, 64, 90], fuzz: 1 };
  const dueWith = r => {
    const store = createStore({ backend: memoryBackend({ [K.gramSrs(P)]: JSON.stringify({ Apfel: { b: 2, due: D, s: 2, r: 2, w: 0, k: 2 } }) }), log: { warn() {} } });
    const s = createSession({ items: [{ card: { id: 'Apfel', module: 'nouns', topic: 'gender', store: 'gramSrs', cfg }, question: { type: 'gender', noun: { de: 'Apfel', g: 'der' } } }], profile: P, store, today: D, module: 'nouns', rng: () => r });
    s.answer('der');
    return store.get(K.gramSrs(P)).Apfel.due;
  };
  assert.deepEqual([dueWith(0), dueWith(0.5), dueWith(0.99)], ['2026-10-21', '2026-10-22', '2026-10-23']);   // box 3 = 4 days −1 / 0 / +1
});

test('wrong then right: one retry, outcome retry, one drop, points 1/2, re-asked later without touching records', () => {
  const items = [item('wal_1', { b: 2, due: D, s: 2, r: 2, w: 0, k: 2 }), item('wal_2'), item('wal_3'), item('wal_4'), item('wal_5')];
  const { store, s } = harness(items);
  const r1 = s.answer(0);
  assert.deepEqual({ ok: r1.ok, final: r1.final }, { ok: false, final: false });
  const r2 = s.answer(1);
  assert.deepEqual({ ok: r2.ok, final: r2.final, outcome: r2.outcome }, { ok: true, final: true, outcome: 'retry' });
  assert.equal(store.get(K.quizSrs(P)).wal_1.b, 1);
  assert.equal(store.get(K.quizStats(P)).wal_1.wrong, 1);
  assert.equal(s.size, 6);                                     // the card was queued again
  s.next(); s.answer(1); s.next(); s.answer(1); s.next(); s.answer(1); s.next();
  const cur = s.current();
  assert.equal(cur.item.card.id, 'wal_1');
  assert.equal(cur.rehearsal, true);
  const before = JSON.stringify(store.get(K.quizSrs(P)).wal_1);
  s.answer(1);
  assert.equal(JSON.stringify(store.get(K.quizSrs(P)).wal_1), before);
  s.next(); s.answer(1);
  const sum = s.finish();
  assert.deepEqual([sum.total, sum.firstTry, sum.retried, sum.wrong], [5, 4, 1, 0]);
  assert.equal(sum.pct, 9 / 10);
});

test('wrong twice: final wrong, box 0, re-asked', () => {
  const { store, s } = harness([item('wal_1', { b: 3, due: D, s: 3, r: 3, w: 0, k: 3 }), item('wal_2')]);
  s.answer(0);
  const r = s.answer(0);
  assert.deepEqual({ final: r.final, outcome: r.outcome, expected: r.expected }, { final: true, outcome: 'wrong', expected: 1 });
  assert.equal(store.get(K.quizSrs(P)).wal_1.b, 2);
  assert.equal(s.size, 3);
  assert.throws(() => { s.next(); s.next(); }, /answer first/);
});

test('trainer cards also feed the old gram_days counters', () => {
  const store = createStore({ backend: memoryBackend(), log: { warn() {} } });
  const s = createSession({ items: [{ card: { id: 'Apfel', module: 'nouns', topic: 'gender', store: 'gramSrs', cfg: { intervals: [0, 1, 2, 4, 8, 16, 32, 64, 90], fuzz: 1 } }, question: { type: 'gender', noun: { de: 'Apfel', g: 'der' } } }], profile: P, store, today: D, module: 'nouns' });
  s.answer('der');
  assert.equal(store.get(K.gramSrs(P)).Apfel.b, 1);
  assert.deepEqual(store.get(K.gramDays(P))[D], { a: 1, c: 1, n: 1, m: 0 });
  assert.equal(store.has(K.quizStats(P)), false);
  s.next();
  s.finish();
  assert.equal(store.has(K.quizHistory(P)), false, 'a trainer round is not a quiz round');
});

test('an empty session finishes without writing anything', () => {
  const { store, s } = harness([]);
  assert.equal(s.current(), null);
  const sum = s.finish();
  assert.equal(sum.total, 0);
  assert.equal(store.has(K.quizHistory(P)), false);
});
