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
  assert.deepEqual(store.get(K.planDays(P))[D], { a: 1, c: 1, n: 1 });
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
  assert.equal(store.get(K.planDays(P))[D].sess, 1);
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
  s.finish();
  assert.equal(store.get(K.quizHistory(P)).length, 1);
});

test('an empty session finishes without writing anything', () => {
  const { store, s } = harness([]);
  assert.equal(s.current(), null);
  const sum = s.finish();
  assert.equal(sum.total, 0);
  assert.equal(store.has(K.quizHistory(P)), false);
});
