// Pins the behaviour of the sync merge strategies (ported from the old
// sync.js) and checks the algebra every strategy must satisfy:
//   idempotent    merge(a, a) = a
//   commutative   merge(a, b) = merge(b, a)   (for inputs without exact ties)
//   associative   merge(merge(a, b), c) = merge(a, merge(b, c))
//   monotone      progress never goes down
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeMax, mergeSrs, mergeMaxPerEntry, mergeMaxPerEntryDeep, mergeDeepUnion, mergeHistory, histSortKey,
  mergeEditorBank, mergeNewest, mergeProfiles, mergeErrorLog, STRATEGIES, ERROR_LOG_MAX,
} from '../app/core/merges.js';
import { REGISTRY } from '../app/core/storage.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(42);
const pick = arr => arr[Math.floor(rng() * arr.length)];
const int = n => Math.floor(rng() * n);
const same = (x, y) => assert.deepEqual(JSON.parse(JSON.stringify(x)), JSON.parse(JSON.stringify(y)));
const setEq = (x, y) => same([...x].map(v => JSON.stringify(v)).sort(), [...y].map(v => JSON.stringify(v)).sort());

// A record fully determined by (s, b, due): ties then mean equality.
function srsRecord() {
  const s = 1 + int(12), b = int(6), due = `2026-${String(1 + int(12)).padStart(2, '0')}-${String(1 + int(28)).padStart(2, '0')}`;
  const w = Math.min(s, b % 3);
  return { b, due, s, r: s - w, w, k: b };
}
function srsStore() {
  const o = {};
  for (const w of ['Apfel', 'Birne', 'Haus', 'Maus', 'Zug']) if (rng() < 0.7) o[w] = srsRecord();
  return o;
}

function algebra(name, merge, gen, eq = same) {
  test(`${name}: idempotent, commutative, associative (200 random cases)`, () => {
    for (let i = 0; i < 200; i++) {
      const a = gen(), b = gen(), c = gen();
      eq(merge(a, a), a);
      eq(merge(a, b), merge(b, a));
      eq(merge(merge(a, b), c), merge(a, merge(b, c)));
    }
  });
}

// ── pinned behaviour of the old strategies ─────────────────────────────

test('mergeMax: highest wins, garbage counts as 0', () => {
  assert.equal(mergeMax(3, 7), 7);
  assert.equal(mergeMax('12', 7), 12);
  assert.equal(mergeMax(null, 'x'), 0);
});

test('mergeSrs: per word more practice wins; ties by box, then later due; local on a full tie', () => {
  const l = { Apfel: { b: 2, due: '2026-10-01', s: 5, r: 4, w: 1, k: 2 }, Haus: { b: 1, due: '2026-10-03', s: 2, r: 1, w: 1, k: 0 } };
  const r = { Apfel: { b: 1, due: '2026-10-09', s: 6, r: 4, w: 2, k: 0 }, Haus: { b: 3, due: '2026-10-02', s: 2, r: 2, w: 0, k: 2 }, Zug: { b: 0, due: '2026-10-01', s: 1, r: 0, w: 1, k: 0 } };
  const m = mergeSrs(l, r);
  assert.equal(m.Apfel.s, 6);            // more practice
  assert.equal(m.Haus.b, 3);             // same s → higher box
  assert.equal(m.Zug.s, 1);              // only remote
  const tie = mergeSrs({ a: { b: 1, due: '2026-10-01', s: 3, k: 9 } }, { a: { b: 1, due: '2026-10-01', s: 3, k: 1 } });
  assert.equal(tie.a.k, 9);              // local wins a full tie
  const later = mergeSrs({ a: { b: 1, due: '2026-10-01', s: 3 } }, { a: { b: 1, due: '2026-10-05', s: 3 } });
  assert.equal(later.a.due, '2026-10-05');
  same(mergeSrs(null, r), r);
  same(mergeSrs(l, undefined), l);
});
algebra('mergeSrs', mergeSrs, srsStore);

test('mergeSrs is monotone: no word loses practice', () => {
  for (let i = 0; i < 100; i++) {
    const a = srsStore(), b = srsStore(), m = mergeSrs(a, b);
    for (const w of new Set([...Object.keys(a), ...Object.keys(b)])) {
      assert.ok(m[w].s >= Math.max(a[w]?.s || 0, b[w]?.s || 0));
    }
  }
});

test('mergeMaxPerEntry: field-wise maximum, local non-numbers kept, whole entries added', () => {
  const l = { '2026-10-01': { a: 10, c: 8, note: 'x' }, akk: { a: 3 } };
  const r = { '2026-10-01': { a: 12, c: 5, note: 'y', n: 2 }, dat: { a: 1 } };
  same(mergeMaxPerEntry(l, r), { '2026-10-01': { a: 12, c: 8, note: 'x', n: 2 }, akk: { a: 3 }, dat: { a: 1 } });
  same(mergeMaxPerEntry({ k: 5 }, { k: { a: 1 } }), { k: { a: 1 } });   // a local scalar is replaced by the remote object's fields (old rule, pinned)
  same(mergeMaxPerEntry(null, r), r);
});
const dayStore = () => {
  const o = {};
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-03']) if (rng() < 0.7) o[d] = { a: int(50), c: int(50), n: int(10) };
  return o;
};
algebra('mergeMaxPerEntry (numeric)', mergeMaxPerEntry, dayStore);

test('mergeMaxPerEntryDeep: equals the flat rule on flat entries and merges nested state', () => {
  for (let i = 0; i < 100; i++) { const a = dayStore(), b = dayStore(); same(mergeMaxPerEntryDeep(a, b), mergeMaxPerEntry(a, b)); }
  // The regression the old flat rule had: units passed on two devices.
  const l = { akk: { unit: 3, passed: { 1: 100, 2: 200 }, fest: { '2026-10-01': 2 }, mc: { tries: 1, passed: false } } };
  const r = { akk: { unit: 2, passed: { 1: 100, 3: 300 }, fest: { '2026-10-02': 1 }, mc: { tries: 2, passed: true, nextTry: '2026-10-05' } } };
  const flat = mergeMaxPerEntry(l, r), deep = mergeMaxPerEntryDeep(l, r);
  assert.deepEqual(Object.keys(flat.akk.passed), ['1', '2']);              // unit 3 lost
  assert.deepEqual(Object.keys(deep.akk.passed), ['1', '2', '3']);         // kept
  assert.equal(deep.akk.unit, 3);
  assert.equal(deep.akk.mc.tries, 2);
  assert.equal(deep.akk.mc.passed, false);                                 // non-number: local kept (as the flat rule)
  assert.equal(deep.akk.mc.nextTry, '2026-10-05');                         // added when local lacks it
  assert.deepEqual(Object.keys(deep.akk.fest).sort(), ['2026-10-01', '2026-10-02']);
});
const pathStore = () => ({ akk: { unit: int(5), passed: Object.fromEntries([1, 2, 3].filter(() => rng() < 0.5).map(n => [n, n * 100])), mc: { tries: int(4) } } });
algebra('mergeMaxPerEntryDeep', mergeMaxPerEntryDeep, pathStore);

test('mergeDeepUnion: arrays unite without duplicates, objects recurse, scalars local-first', () => {
  setEq(mergeDeepUnion([1, 2], [2, 3]), [1, 2, 3]);
  same(mergeDeepUnion({ a: [1], b: { x: 1 } }, { a: [2], b: { y: 2 }, c: 3 }), { a: [1, 2], b: { x: 1, y: 2 }, c: 3 });
  assert.equal(mergeDeepUnion(5, 6), 5);
  assert.equal(mergeDeepUnion(undefined, 6), 6);
});
const badgeStore = () => Object.fromEntries(['early', 'streak7', 'zoo10'].filter(() => rng() < 0.6).map(b => [b, '2026-10-0' + (1 + int(9))]));
algebra('mergeDeepUnion (badge objects)', mergeDeepUnion, () => {
  const o = badgeStore();
  for (const k of Object.keys(o)) o[k] = '2026-10-05';   // identical values where both have the key
  return o;
});
algebra('mergeDeepUnion (arrays, as sets)', mergeDeepUnion, () => [1, 2, 3, 4, 5].filter(() => rng() < 0.5), setEq);

test('mergeHistory: union by identity, chronological in both date paddings, last 10', () => {
  const h = (date, time, pct) => ({ date, time, mode: 'mixed', pct, module: 'water', topics: {} });
  const l = [h('5.3.2026', '10:00', 80), h('20.3.2026', '09:00', 90)];
  const r = [h('5.3.2026', '10:00', 80), h('12.03.2026', '17:30', 70)];
  const m = mergeHistory(l, r);
  assert.deepEqual(m.map(x => x.date), ['5.3.2026', '12.03.2026', '20.3.2026']);
  assert.equal(histSortKey(h('5.3.2026', '10:00')), '2026-03-05 10:00');
  assert.equal(histSortKey(h('05.03.2026', '10:00')), '2026-03-05 10:00');
  assert.equal(histSortKey({ date: 'garbage' }), '0000 garbage');
  const many = Array.from({ length: 14 }, (_, i) => h(`${i + 1}.4.2026`, '08:00', i));
  assert.equal(mergeHistory(many.slice(0, 8), many.slice(6)).length, 10);
  assert.equal(mergeHistory(many.slice(0, 8), many.slice(6)).at(-1).pct, 13);
  same(mergeHistory(null, undefined), []);
});
algebra('mergeHistory', mergeHistory, () => {
  // unique (date,time) per entry so that ties mean equality
  return [1, 2, 3, 4, 5, 6].filter(() => rng() < 0.6).map(i => ({ date: `${i}.5.2026`, time: '08:00', mode: 'mixed', pct: i * 10, module: 'water' }));
});

test('mergeEditorBank: per topic the newer timestamp wins, else the longer list, else local', () => {
  const q = n => Array.from({ length: n }, (_, i) => ({ id: `q${i}` }));
  const l = { a: q(2), b: q(3), c: q(1), __meta: { topics: { a: { ts: 10 }, b: { ts: 5 } } } };
  const r = { a: q(5), b: q(1), d: q(2), __meta: { topics: { a: { ts: 8 }, b: { ts: 9 }, d: { ts: 1 } } } };
  const m = mergeEditorBank(l, r);
  assert.equal(m.a.length, 2);   // local newer
  assert.equal(m.b.length, 1);   // remote newer
  assert.equal(m.c.length, 1);   // local only
  assert.equal(m.d.length, 2);   // remote only
  same(m.__meta, { topics: { a: { ts: 10 }, b: { ts: 9 }, d: { ts: 1 } } });
  const noMeta = mergeEditorBank({ a: q(2) }, { a: q(3) });
  assert.equal(noMeta.a.length, 3);
  same(mergeEditorBank({ a: q(2) }, { a: q(2) }).a, q(2));   // full tie: local
  same(mergeEditorBank(null, 'x'), {});
});
algebra('mergeEditorBank', mergeEditorBank, () => {
  const o = {}, topics = {};
  for (const t of ['kap01', 'kap02']) if (rng() < 0.7) { const ts = 1 + int(50); o[t] = [{ ts }]; topics[t] = { ts }; }
  if (Object.keys(topics).length) o.__meta = { topics };   // the rule drops an empty __meta
  return o;
});

// ── new strategies ────────────────────────────────────────────────────

test('mergeNewest: larger updatedAt wins, missing sides handled', () => {
  same(mergeNewest({ updatedAt: 1, tests: {} }, { updatedAt: 2, tests: { w: 'x' } }), { updatedAt: 2, tests: { w: 'x' } });
  same(mergeNewest({ updatedAt: 3 }, { updatedAt: 2 }), { updatedAt: 3 });
  same(mergeNewest(null, { updatedAt: 2 }), { updatedAt: 2 });
  same(mergeNewest({ updatedAt: 2 }, 'junk'), { updatedAt: 2 });
});
algebra('mergeNewest', mergeNewest, () => { const u = 1 + int(30); return { updatedAt: u, tests: { m: `d${u}` } }; });

test('mergeProfiles: union of profiles, per profile the newer updatedAt wins', () => {
  const l = { v: 1, profiles: { A: { name: 'A', grade: 3, updatedAt: 5 }, B: { name: 'B', updatedAt: 9 } } };
  const r = { v: 1, profiles: { A: { name: 'A', grade: 4, updatedAt: 7 }, C: { name: 'C', updatedAt: 1 } } };
  same(mergeProfiles(l, r), { v: 1, profiles: { A: { name: 'A', grade: 4, updatedAt: 7 }, B: { name: 'B', updatedAt: 9 }, C: { name: 'C', updatedAt: 1 } } });
  same(mergeProfiles(null, r), r);
  same(mergeProfiles(undefined, undefined), { v: 1, profiles: {} });
});
algebra('mergeProfiles', mergeProfiles, () => {
  const profiles = {};
  for (const k of ['A', 'B']) if (rng() < 0.7) { const u = 1 + int(20); profiles[k] = { name: k, grade: u % 4, updatedAt: u }; }
  return { v: 1, profiles };
});

test('mergeErrorLog: union by (ts,msg), sorted, capped', () => {
  const e = (ts, msg) => ({ ts, msg, v: '1' });
  same(mergeErrorLog([e(2, 'b'), e(1, 'a')], [e(2, 'b'), e(3, 'c')]), [e(1, 'a'), e(2, 'b'), e(3, 'c')]);
  const many = Array.from({ length: 250 }, (_, i) => e(i, 'm'));
  assert.equal(mergeErrorLog(many, []).length, ERROR_LOG_MAX);
  assert.equal(mergeErrorLog(many, []).at(-1).ts, 249);
});
algebra('mergeErrorLog', mergeErrorLog, () => [1, 2, 3, 4].filter(() => rng() < 0.5).map(i => ({ ts: i, msg: `m${i}` })));

test('every sync rule named in the registry has a strategy', () => {
  for (const e of REGISTRY) if (e.sync) assert.equal(typeof STRATEGIES[e.sync], 'function', `${e.id} → ${e.sync}`);
});
