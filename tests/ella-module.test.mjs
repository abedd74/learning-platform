// Deutsch mit Ella, the module itself (not only its pure helpers): the items
// it puts into a session and what an answer does to the records — each case
// below is a difference to the old trainer that an independent review found
// in November 2026. Runs on the real noun pack with a fake app context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore, memoryBackend, keys as K } from '../app/core/storage.js';
import { createSession } from '../app/core/session.js';
import { config as planConfig } from '../app/core/planner.js';
import { today as todayOf, addDays } from '../app/core/time.js';
import { createEllaModule } from '../app/engines/ella/index.js';
import { ART } from '../app/engines/ella/rules.js';

const P = 'Testkind';
const read = f => JSON.parse(readFileSync(new URL(`../content/nouns/${f}`, import.meta.url), 'utf8'));
const pack = read('pack.json');
const data = {
  pack, nouns: read(pack.files.nouns).items, categories: read(pack.files.categories), templates: read(pack.files.templates),
  wortbau: read(pack.files.wortbau).items, paths: Object.fromEntries(Object.entries(pack.files.paths).map(([k, f]) => [k, read(f).units])),
};
const TODAY = todayOf();

function harness({ known = 60, box = 4, path = {} } = {}) {
  const srs = {};
  for (const n of data.nouns.slice(0, known)) srs[n.de] = { b: box, due: addDays(TODAY, 20), s: 6, r: 6, w: 0, k: 3 };
  for (const n of data.nouns.filter(n => /(nis|schaft|tum)$/.test(n.de))) srs[n.de] = { b: box, due: addDays(TODAY, 20), s: 6, r: 6, w: 0, k: 1 };
  const store = createStore({ backend: memoryBackend({ [K.gramSrs(P)]: JSON.stringify(srs), [K.gramPath(P)]: JSON.stringify(path) }), log: { warn() {} } });
  const started = [];
  const ctx = {
    store, profile: { key: P }, plannerCfg: planConfig(), i18n: { showItalian: false, t: id => id }, audio: {},
    router: { navigate() {} }, startSession: cfg => started.push(cfg), go() {},
  };
  return { store, ctx, started, ella: createEllaModule(ctx, data) };
}
const gold = (extra = {}) => ({ unit: 99, passed: { 1: 1 }, mc: { tries: 1, passed: 1 }, gBox: 1, gDue: addDays(TODAY, 30), ...extra });
const fest = () => ({ unit: 99, passed: { 1: 1 }, fest: {} });
const wrongGender = q => ART[q.kase][q.defArt][['der', 'die', 'das'].find(g => g !== q.noun.g && ART[q.kase][q.defArt][g] !== q.solution)];

test('grammar sentences in a round are booked on their own concept', () => {
  const { ella } = harness({ path: { akk: gold(), dat: gold() } });
  let seen = 0;
  for (let i = 0; i < 60; i++) for (const it of ella.extraItems(4)) {
    if (it.question.type !== 'case') continue;
    seen++;
    assert.equal(it.card.concept, it.question.kase);
    assert.equal(it.card.topic, it.question.kase);
  }
  assert.ok(seen > 100);
});

test('a case sentence has no record and is never a new card; a re-asked one is not counted twice', () => {
  const { ella, store } = harness({ path: { akk: fest() } });
  const item = ella.extraItems(4).find(it => it.question.type === 'case');
  assert.equal(item.card.store, null);
  const q = item.question;
  const filler = { card: { id: 'x1', module: 'nouns', topic: 'akk', store: null }, question: { type: 'pmcq', opts: ['a', 'b'], correct: 'a' } };
  const s = createSession({ items: [item, filler, filler, filler, filler], profile: P, store, today: TODAY, module: 'nouns' });
  const before = JSON.stringify(store.get(K.gramSrs(P))[q.noun.de]);
  // first try: the right gender in the wrong case; second try right → a case mistake, the noun is left alone
  const caseSlip = q.opts.find(o => o !== q.solution && o !== wrongGender(q)) || wrongGender(q);
  s.answer(caseSlip); s.answer(q.solution); s.next();
  for (let i = 0; i < 3; i++) { s.answer('a'); s.next(); }
  assert.equal(s.current().rehearsal, true, 'the missed sentence comes again');
  s.answer(q.solution); s.next();
  s.answer('a'); s.next(); s.finish();
  const stat = store.get(K.gramCase(P))[q.kase];
  assert.equal(stat.a, 1, 'the re-ask is not a second attempt in the statistics');
  assert.equal(stat.c, 0);
  assert.equal(store.get(K.planDays(P))[TODAY].n, 0);
  assert.equal(store.get(K.gramDays(P))[TODAY].n, undefined);
  if (caseSlip !== wrongGender(q)) assert.equal(JSON.stringify(store.get(K.gramSrs(P))[q.noun.de]), before);
});

test('a gender mistake in a sentence sends the noun back into the reviews: one box down, due today, streak 0', () => {
  const { ella, store } = harness({ path: { dat: fest(), akk: gold() } });
  let item;
  for (let i = 0; i < 50 && !item; i++) item = ella.extraItems(4).find(it => it.question.type === 'case' && it.question.kase === 'dat' && wrongGender(it.question));
  const q = item.question;
  const s = createSession({ items: [item], profile: P, store, today: TODAY, module: 'nouns' });
  s.answer(wrongGender(q)); s.answer(wrongGender(q));
  const rec = store.get(K.gramSrs(P))[q.noun.de];
  assert.deepEqual({ b: rec.b, due: rec.due, k: rec.k, s: rec.s, w: rec.w }, { b: 3, due: TODAY, k: 0, s: 6, w: 0 });
  const stat = store.get(K.gramCase(P));
  assert.deepEqual(Object.keys(stat), ['dat'], 'recorded under the sentence\'s own case');
  assert.equal(stat.dat.gErr + stat.dat.bothErr, 1);
});

test('"Weiß ich nicht" on a sentence counts against the case and leaves the noun\'s own record alone', () => {
  const { ella, store } = harness({ path: { dat: fest(), akk: gold() } });
  let item;
  for (let i = 0; i < 50 && !item; i++) item = ella.extraItems(4).find(it => it.question.type === 'case' && it.question.kase === 'dat' && wrongGender(it.question));
  const q = item.question;
  const before = JSON.stringify(store.get(K.gramSrs(P))[q.noun.de]);
  const s = createSession({ items: [item], profile: P, store, today: TODAY, module: 'nouns' });
  assert.equal(s.giveUp().expected, q.solution);
  assert.equal(JSON.stringify(store.get(K.gramSrs(P))[q.noun.de]), before, 'no article was named: the noun is not sent back');
  const stat = store.get(K.gramCase(P));
  assert.deepEqual(Object.keys(stat), ['dat']);
  assert.equal(stat.dat.bothErr, 1, 'recorded as a miss of the case, kind unknown');
});

test('an article question from Nomen-Bausteine is a real noun card and moves the noun\'s record', () => {
  const { ella, store } = harness({ path: { nomen: fest() } });
  let item;
  for (let i = 0; i < 80 && !item; i++) item = ella.extraItems(4).find(it => it.question.type === 'gender');
  assert.ok(item, 'a gender question turned up');
  assert.equal(item.card.store, 'gramSrs');
  assert.equal(item.card.id, item.question.noun.de);
  assert.equal(item.card.concept, 'nomen');
  const s = createSession({ items: [item], profile: P, store, today: TODAY, module: 'nouns', rng: () => 0.5 });
  s.answer(item.question.noun.g);
  const rec = store.get(K.gramSrs(P))[item.question.noun.de];
  assert.deepEqual({ b: rec.b, s: rec.s }, { b: 5, s: 7 });
  assert.equal(store.get(K.planDays(P))[TODAY].n, 0, 'a known noun is not a new card');
});

test('the daily training hands the planner a card SOURCE: every round is planned from the records as they are', () => {
  const { ella, store, started } = harness({ known: 3 });
  ella.startTraining();
  const cfg = started[0];
  assert.equal(cfg.grammar, true);
  assert.equal(typeof cfg.cards, 'function');
  const fresh = cfg.cards().find(c => !c.rec);
  const all = store.get(K.gramSrs(P));
  all[fresh.id] = { b: 1, due: addDays(TODAY, 1), s: 1, r: 1, w: 0, k: 1 };
  store.set(K.gramSrs(P), all);
  assert.equal(cfg.cards().find(c => c.id === fresh.id).rec.b, 1, 'the next round sees the record the last round wrote');
});

test('an ordinary round moves a Gold concept; the bookkeeping gets the outcomes per concept', () => {
  const { ella, store } = harness({ path: { akk: gold({ gDue: addDays(TODAY, -1) }) } });
  ella.afterTraining({ results: [{ concept: 'akk', outcome: 'first' }, { concept: 'akk', outcome: 'first', rehearsal: true }], firstTry: 1, total: 1 }, 0);
  const st = store.get(K.gramPath(P)).akk;
  assert.equal(st.gBox, 2);
  assert.equal(st.gDue, addDays(TODAY, 30));
});
