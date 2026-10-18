import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, normalizeText, normalizeExact, diffLetters } from '../app/engines/quiz/check.js';

test('normalizeText is the old lenient rule: case, punctuation, umlauts, articles, hyphens', () => {
  assert.equal(normalizeText('  Der Wasserstoff! '), 'wasserstoff');
  assert.equal(normalizeText('Säugetiere'), 'saeugetiere');
  assert.equal(normalizeText('Nord-Ostsee'), 'nord ostsee');
  assert.equal(normalizeText('die  Barten.'), 'barten');
  assert.equal(normalizeText("l'acqua"), 'lacqua');   // the apostrophe goes first, so the article rule never sees "l'": old behaviour, pinned
  assert.equal(normalizeText('the Water'), 'water');
  assert.equal(normalizeText('Straße'), 'strasse');
  assert.equal(normalizeText(null), '');
});

test('choice, image, cycle: the chosen index must be the right one', () => {
  const q = { type: 'choice', answer: { options: [{ de: 'a' }, { de: 'b' }], correct: 1 } };
  assert.equal(check(q, 1).ok, true);
  assert.equal(check(q, 0).ok, false);
  assert.equal(check(q, '1').ok, false);
  assert.equal(check({ ...q, type: 'image' }, 1).ok, true);
  assert.equal(check({ ...q, type: 'cycle' }, 1).ok, true);
});

test('multi: the same set of indexes, any order', () => {
  const q = { type: 'multi', answer: { options: [{}, {}, {}], correct: [0, 2] } };
  assert.equal(check(q, [2, 0]).ok, true);
  assert.equal(check(q, [0]).ok, false);
  assert.equal(check(q, [0, 1, 2]).ok, false);
  assert.equal(check(q, 'nope').ok, false);
});

test('bool', () => {
  const q = { type: 'bool', answer: { statement: { de: 's' }, correct: false } };
  assert.equal(check(q, false).ok, true);
  assert.equal(check(q, true).ok, false);
  assert.equal(check(q, 'false').ok, false);
});

test('text: lenient by default, exact when asked, never empty', () => {
  const q = { type: 'text', answer: { accepted: ['zwei', '2'] } };
  assert.equal(check(q, ' Zwei! ').ok, true);
  assert.equal(check(q, '2').ok, true);
  assert.equal(check(q, 'drei').ok, false);
  assert.equal(check(q, '').ok, false);
  assert.equal(check(q, '   ').ok, false);
  const exact = { type: 'text', answer: { accepted: ['Baden-Württemberg'], exact: true } };
  assert.equal(check(exact, 'Baden-Württemberg').ok, true);
  assert.equal(check(exact, ' Baden-Württemberg ').ok, true);
  assert.equal(check(exact, 'baden-württemberg').ok, false);
  assert.equal(check(exact, 'Baden Württemberg').ok, false);
  assert.equal(check(exact, 'Baden-Wuerttemberg').ok, false);
  assert.equal(check(exact, 'Baden-Württemberg'.normalize('NFD')).ok, true);
});

test('order and pairs', () => {
  const o = { type: 'order', answer: { items: [{}, {}, {}], correct: [2, 0, 1] } };
  assert.equal(check(o, [2, 0, 1]).ok, true);
  assert.equal(check(o, [0, 1, 2]).ok, false);
  const p = { type: 'pairs', answer: { pairs: [{}, {}, {}] } };
  assert.equal(check(p, { 0: 0, 1: 1, 2: 2 }).ok, true);
  assert.equal(check(p, { 0: 1, 1: 0, 2: 2 }).ok, false);
  assert.equal(check(p, { 0: 0 }).ok, false);
  assert.equal(check(p, null).ok, false);
});

test('trainer items: gender, case, path items', () => {
  assert.equal(check({ type: 'gender', noun: { de: 'Apfel', g: 'der' } }, 'der').ok, true);
  assert.equal(check({ type: 'gender', noun: { de: 'Apfel', g: 'der' } }, 'die').ok, false);
  assert.equal(check({ type: 'case', solution: 'den' }, 'den').ok, true);
  assert.equal(check({ type: 'pfill', correct: 'nis' }, 'nis').ok, true);
  assert.equal(check({ type: 'pmcq', correct: 'ein Buch' }, 'liest').ok, false);
  assert.equal(check({ type: 'unknown' }, 1).ok, false);
});

test('diffLetters marks wrong, missing and extra letters', () => {
  assert.deepEqual(diffLetters('Bayern', 'Bayern'), 'Bayern'.split('').map(ch => ({ ch, ok: true })));
  const d = diffLetters('Bayern', 'Baiern');
  assert.equal(d[2].ok, false);
  assert.equal(d.filter(x => !x.ok).length, 1);
  assert.equal(diffLetters('Bayern', 'Bay').filter(x => !x.ok).length, 3);
  assert.equal(diffLetters('Bay', 'Bayern').filter(x => x.extra).length, 3);
  assert.equal(normalizeExact('  a  b '), 'a b');
});
