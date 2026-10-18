import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, keys as K } from '../app/core/storage.js';
import { isTrap, genderRule, trapNote, diagnoseCase, buildCase, masteredCount, nounStatus, buckets, ART } from '../app/engines/ella/rules.js';
import { createConcepts, CONCEPTS, FEST_MIN_DAYS, MC_RETRY_DAYS, GOLD_INTERVALS } from '../app/engines/ella/concepts.js';
import { BADGES, checkBadges } from '../app/engines/ella/badges.js';
import { genderQuestion, caseQuestion, nomenQuestion, newPriority, pathQuestion } from '../app/engines/ella/items.js';
import golden from './fixtures/live-ids.json' with { type: 'json' };

const P = 'Testkind';
const N = (de, g, extra = {}) => ({ de, g, pl: de + 'e', it: 'x', itG: g === 'die' ? 'f' : 'm', em: '🙂', cat: 'dinge', ...extra });

test('traps: Italian gender misleads', () => {
  assert.ok(!isTrap({ g: 'der', itG: 'm' }));
  assert.ok(!isTrap({ g: 'die', itG: 'f' }));
  assert.ok(isTrap({ g: 'das', itG: 'm' }));
  assert.ok(isTrap({ g: 'der', itG: 'f' }));
  assert.equal(trapNote({ g: 'der', itG: 'm', it: 'il x' }), null);
  assert.match(trapNote({ de: 'Sonne', g: 'die', itG: 'm', it: 'il sole' }), /il sole/);
});

test('gender rules by ending', () => {
  assert.match(genderRule({ de: 'Zeitung', g: 'die' }), /-ung/);
  assert.match(genderRule({ de: 'Mädchen', g: 'das' }), /-chen/);
  assert.match(genderRule({ de: 'Reichtum', g: 'der' }), /Angeber/);
  assert.match(genderRule({ de: 'Wachstum', g: 'das' }), /fast immer DAS/);
  assert.match(genderRule({ de: 'Erlaubnis', g: 'die' }), /Ausnahme/);
  assert.match(genderRule({ de: 'Mai', g: 'der', rule: 'monat' }), /Monate/);
  assert.equal(genderRule({ de: 'Apfel', g: 'der' }), null);
});

test('case diagnosis and sentence building', () => {
  const hund = N('Hund', 'der');
  assert.equal(diagnoseCase('die', 'akk', hund), 'gender');   // die is akk of DIE
  assert.equal(diagnoseCase('der', 'akk', hund), 'case');     // der is nom of DER (or dat of DIE)
  assert.equal(diagnoseCase('dem', 'akk', hund), 'case');
  assert.equal(diagnoseCase('einer', 'akk', hund), 'both');
  const b = buildCase({ t: 'Ich sehe %A %N.' }, hund, 'akk', 'def');
  assert.deepEqual(b, { sentence: 'Ich sehe ___ Hund.', solution: 'den', nounForm: 'Hund', opts: ['der', 'die', 'das', 'den', 'dem'] });
  const affe = N('Affe', 'der', { obl: 'Affen' });
  assert.equal(buildCase({ t: 'Ich sehe %A %N.' }, affe, 'akk', 'indef').sentence, 'Ich sehe ___ Affen.');
  assert.equal(buildCase({ t: '%A %N' }, affe, 'nom', 'def').nounForm, 'Affe');
  assert.equal(ART.dat.indef.die, 'einer');
});

test('mastered, status, buckets', () => {
  const srs = { a: { b: 3, w: 0 }, b: { b: 1, w: 4 }, c: { b: 4, w: 1 }, d: { b: 2, w: 0 } };
  assert.equal(masteredCount(srs), 2);
  assert.equal(nounStatus(undefined), 'neu');
  assert.equal(nounStatus(srs.b), 'hilfe');
  assert.equal(nounStatus(srs.c), 'sicher');
  assert.equal(nounStatus(srs.a), 'fast');
  assert.equal(nounStatus(srs.d), 'arbeit');
  assert.deepEqual(buckets([N('a', 'der'), N('b', 'der'), N('c', 'der'), N('d', 'der'), N('e', 'der')], srs), { neu: 1, lernen: 1, fast: 1, gemeistert: 2 });
});

function concepts(init = {}, day = '2026-10-18') {
  const store = createStore({ backend: memoryBackend(init), log: { warn() {} } });
  const units = { akk: [1, 2, 3, 4, 5], dat: [1, 2, 3, 4, 5], nomen: [1, 2, 3, 4] };
  const c = createConcepts({ store, profile: P, units, today: () => day });
  return { store, c, setDay: d => { day = d; } };
}

test('concept lifecycle: Lernpfad → Festigen → Meister-Check → Gold → refreshers', () => {
  const { store, c, setDay } = concepts();
  assert.ok(c.pathOpen('akk'));
  assert.ok(!c.pathOpen('dat'), 'Dativ needs Akkusativ gold');
  assert.ok(c.pathOpen('nomen'));
  assert.equal(c.nextUnit('akk'), 1);
  // pass units 1..4, then the final (5)
  assert.deepEqual(c.recordPath('akk', 1, { wrong: 0, retries: 1 }), { passed: true, nowDone: false });
  assert.deepEqual(c.recordPath('akk', 2, { wrong: 0, retries: 2 }), { passed: false, nowDone: false });   // too many retries
  assert.deepEqual(c.recordPath('akk', 2, { wrong: 1, retries: 0 }), { passed: false, nowDone: false });
  for (const u of [2, 3, 4]) c.recordPath('akk', u, { wrong: 0, retries: 0 });
  assert.equal(c.nextUnit('akk'), 5);
  assert.deepEqual(c.recordPath('akk', 5, { wrong: 0, retries: 2 }), { passed: true, nowDone: true });
  assert.ok(c.done('akk'));
  assert.ok(c.inFest('akk'));
  assert.ok(!c.mcReady('akk'));
  assert.deepEqual(Object.keys(store.get(K.gramPath(P)).akk.passed), ['1', '2', '3', '4', '5']);
  // three practice days
  for (const d of ['2026-10-18', '2026-10-19', '2026-10-20']) { setDay(d); c.afterSession({ akk: ['first', 'wrong'] }); }
  assert.equal(c.festDays('akk'), FEST_MIN_DAYS);
  assert.ok(c.mcReady('akk'));
  assert.ok(!c.mcOverdue('akk'));
  setDay('2026-10-22');
  assert.ok(c.mcOverdue('akk'));
  // fail the check: retry in 2 days
  assert.deepEqual(c.recordMc('akk', 6, 10), { passed: false, need: 8 });
  assert.ok(!c.mcReady('akk'));
  setDay('2026-10-24');
  assert.ok(c.mcReady('akk'));
  assert.equal(store.get(K.gramPath(P)).akk.mc.tries, 1);
  // pass it
  assert.deepEqual(c.recordMc('akk', 8, 10), { passed: true, need: 8 });
  assert.ok(c.gold('akk'));
  assert.ok(!c.inFest('akk'));
  assert.ok(c.pathOpen('dat'));
  assert.equal(store.get(K.gramPath(P)).akk.gDue, '2026-10-31');
  assert.ok(!c.due('akk'));
  setDay('2026-10-31');
  assert.ok(c.due('akk'));
  c.afterSession({ akk: ['first', 'first'] });
  assert.equal(store.get(K.gramPath(P)).akk.gBox, 1);
  assert.equal(store.get(K.gramPath(P)).akk.gDue, '2026-11-14');
  setDay('2026-11-01');
  c.afterSession({ akk: ['first', 'wrong'] });                    // a mistake pulls it back
  assert.equal(store.get(K.gramPath(P)).akk.gBox, 0);
  assert.equal(store.get(K.gramPath(P)).akk.gDue, '2026-11-08');
  assert.equal(GOLD_INTERVALS.length, 4);
  assert.equal(MC_RETRY_DAYS, 2);
});

test('a shorter Meister-Check scales the pass mark; parent mode opens everything', () => {
  const { c } = concepts();
  assert.deepEqual(c.recordMc('nomen', 5, 6), { passed: true, need: 5 });
  const parent = createConcepts({ store: createStore({ backend: memoryBackend() }), profile: P, units: { akk: [1], dat: [1], nomen: [1] }, today: () => '2026-10-18', parent: true });
  assert.ok(parent.pathOpen('dat'));
  assert.ok(!parent.mcOverdue('akk'));
});

test('badges: ids as in the old trainer, conditions, perfect round', () => {
  assert.deepEqual(BADGES.map(b => b.id), golden.trainer.badges);
  const facts = { m: 25, streak: 7, goalToday: true, traps: 3, pathAkkDone: false, pathDatDone: false, pathNomDone: true, mcAkk: false, mcDat: false, mcNom: false };
  const { fresh, earned } = checkBadges({ w10: '2026-10-01' }, facts, {}, '2026-10-18');
  assert.deepEqual(fresh.map(b => b.id), ['goal1', 'w25', 'streak3', 'streak7', 'pathnom']);
  assert.equal(earned.w10, '2026-10-01');
  assert.equal(earned.w25, '2026-10-18');
  const again = checkBadges(earned, facts, { perfect: true }, '2026-10-19');
  assert.deepEqual(again.fresh.map(b => b.id), ['perfect']);
});

test('question builders', () => {
  const rng = () => 0.5;
  const nouns = [N('Hund', 'der', { cat: 'tiere' }), N('Katze', 'die', { cat: 'tiere' }), N('Haus', 'das', { cat: 'haus' }), N('Mai', 'der', { rule: 'monat' })];
  const srs = { Hund: { b: 3, k: 3 }, Katze: { b: 2, k: 1 }, Haus: { b: 2, k: 0 } };
  const g = genderQuestion(nouns[0], srs.Hund, rng);
  assert.equal(g.type, 'gender');
  assert.equal(g.typed, true);
  assert.equal(genderQuestion(nouns[1], srs.Katze).typed, false);
  const templates = { akk: [{ t: 'Ich sehe %A %N.', it: 'Vedo…', cats: ['tiere'] }], dat: [{ t: 'Ich helfe %A %N.', only: ['Mai'] }] };
  const c = caseQuestion({ kase: 'akk', nouns, srs, templates, rng });
  assert.equal(c.type, 'case');
  assert.ok(['Hund', 'Katze'].includes(c.noun.de));
  assert.ok(c.sentence.includes('___'));
  assert.deepEqual(c.hintFor('die').de.length > 0, true);
  assert.equal(caseQuestion({ kase: 'dat', nouns, srs, templates, rng }), null, 'months never appear in case drills');
  const pq = pathQuestion({ kind: 'pfill', t: 'Erlaub___', opts: ['nis', 'tum'], correct: 'nis', hint: 'h', explain: 'e' });
  assert.equal(pq.type, 'pfill');
  assert.deepEqual(pq.hint, { de: 'h' });
  const recent = [];
  const nq = nomenQuestion({ nouns: [N('Erlaubnis', 'die'), N('Freundschaft', 'die')], srs: {}, wortbau: [{ kind: 'pfill', t: 'x___', opts: ['a', 'b'], correct: 'a' }], recent, rng: () => 0.9 });
  assert.equal(nq.type, 'gender');
  assert.equal(recent.length, 1);
});

test('new-word order: two traps, then one easy word', () => {
  const nouns = [N('T1', 'das'), N('S1', 'der'), N('T2', 'das'), N('T3', 'das'), N('S2', 'der')];
  const pr = newPriority(nouns);
  const order = [...pr.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
  assert.deepEqual(order, ['T1', 'T2', 'S1', 'T3', 'S2']);
});
