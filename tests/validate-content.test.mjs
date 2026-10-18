import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAll, checkQuestion, checkLessonHtml } from '../tools/validate-content.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'lp-content-'));
  for (const [path, value] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}
const run = (files, assets = {}) => {
  const root = fixture({ ...Object.fromEntries(Object.entries(files).map(([k, v]) => [`content/${k}`, v])), ...Object.fromEntries(Object.entries(assets).map(([k, v]) => [`assets/${k}`, v])) });
  return validateAll(join(root, 'content'), join(root, 'assets'));
};

const T = (de, it) => (it ? { de, it } : { de });
const choice = (id, extra = {}) => ({ id, type: 'choice', prompt: T('Frage?', 'Domanda?'), answer: { options: [T('a', 'a'), T('b', 'b')], correct: 0 }, ...extra });
const mod = (extra = {}) => ({ id: 'whales', name: T('Wale'), engine: 'quiz', idPrefix: 'wal_', grades: [4], srs: { intervals: [0, 1, 2, 4, 7, 14] },
  topics: [{ id: 'arten', label: T('Walarten'), file: 'arten.json' }], ...extra });

function errs(q, ctx) { const e = [], w = []; checkQuestion(q, 'q', m => e.push(m), m => w.push(m), ctx); return { e: e.join('\n'), w: w.join('\n') }; }

test('missing content folder is fine', () => {
  const r = validateAll(join(tmpdir(), 'lp-does-not-exist'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.modules, 0);
});

test('a valid module passes', () => {
  const r = run({ 'whales/module.json': mod(), 'whales/arten.json': { items: [choice('wal_arten-h1'), choice('wal_arten-h2', { prompt: T('Andere?', 'Altra?') })] } });
  assert.deepEqual(r.errors, []);
  assert.equal(r.items, 2);
});

test('module-level errors: duplicate ids, prefix, missing file, bad JSON, folder name, engine, intervals', () => {
  const r = run({
    'whales/module.json': mod({ engine: 'magic', srs: { intervals: [3, 1] }, topics: [{ id: 'arten', file: 'arten.json' }, { id: 'x', file: 'missing.json' }, { id: 'y', file: 'bad.json' }] }),
    'whales/arten.json': { items: [choice('wal_a'), choice('wal_a'), choice('book_b'), {}] },
    'whales/bad.json': '{ nope',
    'wale/module.json': mod({ topics: [] }),
  });
  const m = r.errors.join('\n');
  for (const re of [/duplicate id/, /lacks module prefix "wal_"/, /missing id/, /missing\.json not found/, /bad\.json: invalid JSON/, /differs from folder "wale"/, /unknown engine "magic"/, /non-decreasing/]) assert.match(m, re);
});

test('question types: the answer must fit the question', () => {
  assert.match(errs({ ...choice('x'), type: 'riddle' }).e, /unknown type/);
  assert.match(errs(choice('x', { prompt: { de: '' } })).e, /missing German text/);
  assert.match(errs(choice('x', { answer: { options: [T('a'), T('b')], correct: 2 } })).e, /not one of the options/);
  assert.match(errs(choice('x', { answer: { options: [T('a')], correct: 0 } })).e, /at least 2 options/);
  assert.match(errs(choice('x', { answer: { options: [T('a'), T('a')], correct: 0 } })).e, /the same/);
  assert.match(errs({ id: 'x', type: 'multi', prompt: T('?'), answer: { options: [T('a'), T('b')], correct: [0, 0] } }).e, /distinct/);
  assert.match(errs({ id: 'x', type: 'multi', prompt: T('?'), answer: { options: [T('a'), T('b')], correct: [] } }).e, /at least one right/);
  assert.match(errs({ id: 'x', type: 'bool', prompt: T('?'), answer: { statement: T('s'), correct: 'yes' } }).e, /true or false/);
  assert.match(errs({ id: 'x', type: 'text', prompt: T('?'), answer: { prefix: T(''), suffix: T(''), accepted: [] } }).e, /at least one answer/);
  assert.equal(errs({ id: 'x', type: 'text', prompt: T('?'), answer: { prefix: T(''), suffix: T('.'), accepted: ['Eis'] } }).e, '');
  assert.match(errs({ id: 'x', type: 'order', prompt: T('?'), answer: { items: [T('a'), T('b'), T('c')], correct: [0, 0, 1] } }).e, /exactly once/);
  assert.equal(errs({ id: 'x', type: 'order', prompt: T('?'), answer: { items: [T('a'), T('b'), T('c')], correct: [2, 0, 1] } }).e, '');
  assert.match(errs({ id: 'x', type: 'pairs', prompt: T('?'), answer: { pairs: [{ left: T('a'), right: T('b') }] } }).e, /at least 2 pairs/);
  assert.match(errs({ id: 'x', type: 'image', prompt: T('?'), answer: { options: [{ emoji: '', label: T('a') }, { emoji: '💧', label: T('b') }], correct: 0 } }).e, /missing emoji/);
});

test('cycle questions: the right option must be the missing step', () => {
  const module = { cycleSteps: { de: ['Sonne erwärmt', 'Verdunsten', 'Wolkenbildung'] } };
  const q = (correct, gapStep = 1) => ({ id: 'x', type: 'cycle', prompt: T('?'), answer: { lang: 'de', gapStep, options: [T('Verdunsten'), T('Sonne erwärmt')], correct } });
  assert.equal(errs(q(0), { module }).e, '');
  assert.match(errs(q(1), { module }).e, /not the missing step/);
  assert.match(errs(q(0, 9), { module }).e, /gapStep/);
  assert.match(errs({ ...q(0), answer: { ...q(0).answer, lang: 'fr' } }, { module }).e, /no cycle steps/);
});

test('figures must exist under assets/', () => {
  const ok = run({ 'whales/module.json': mod(), 'whales/arten.json': { items: [choice('wal_1', { media: { figure: 'figures/whales/a.svg' } })] } }, { 'figures/whales/a.svg': '<svg/>' });
  assert.deepEqual(ok.errors, []);
  const bad = run({ 'whales/module.json': mod(), 'whales/arten.json': { items: [choice('wal_1', { media: { figure: 'figures/whales/missing.svg' } })] } });
  assert.match(bad.errors.join('\n'), /figure .* not found/);
});

test('warnings: untranslated texts and repeated questions, unknown fields', () => {
  const r = run({ 'whales/module.json': mod(), 'whales/arten.json': { items: [
    choice('wal_1'), choice('wal_2'), choice('wal_3', { prompt: T('Nur Deutsch') }), choice('wal_4', { prompt: T('X', 'x'), extra: 1 }),
  ] } });
  assert.deepEqual(r.errors, []);
  const w = r.warnings.join('\n');
  assert.match(w, /same question as wal_1/);
  assert.match(w, /1 question\(s\) with some text not translated/);
  assert.match(w, /unknown field "extra"/);
});

test('lesson HTML: a few harmless tags only', () => {
  const e = [];
  checkLessonHtml('<p>Der <b>Hund</b> <span class="it" style="color:red">frisst</span>.<br></p><div>ok</div>', 'l', m => e.push(m));
  assert.deepEqual(e, []);
  checkLessonHtml('<p onclick="x()">a</p><img src=x><a href="#">b</a><script>1</script>', 'l', m => e.push(m));
  const m = e.join('\n');
  assert.match(m, /forbidden markup/);
  assert.match(m, /attribute "onclick"/);
  assert.match(m, /tag <a>/);
});

const nounPack = (over = {}) => ({
  'nouns/pack.json': { id: 'nouns', srs: { intervals: [0, 1, 2, 4] }, files: { nouns: 'nouns.json', categories: 'categories.json', templates: 'templates.json', paths: { akk: 'path-akk.json' }, wortbau: 'wortbau.json' } },
  'nouns/categories.json': { tiere: { label: T('Tiere'), icon: '🐾' } },
  'nouns/nouns.json': { items: [{ de: 'Hund', g: 'der', pl: 'Hunde', it: 'il cane', itG: 'm', em: '🐕', cat: 'tiere' }] },
  'nouns/templates.json': { akk: [{ t: 'Ich sehe %A %N.', it: 'Vedo…', cats: ['tiere'] }], dat: [{ t: 'Ich helfe %A %N.', it: 'Aiuto…', only: ['Hund'] }] },
  'nouns/path-akk.json': { units: [{ n: 1, title: 'Wer macht was?', lessonHtml: '<p>Hallo</p>', items: [{ kind: 'pfill', t: 'Ich sehe ___ Hund.', opts: ['den', 'der'], correct: 'den' }] }] },
  'nouns/wortbau.json': { items: [{ kind: 'pfill', t: 'die Erlaub___', opts: ['nis', 'tum'], correct: 'nis' }] },
  ...over,
});

test('the noun pack: a valid pack passes', () => {
  const r = run(nounPack());
  assert.deepEqual(r.errors, []);
  assert.equal(r.nouns, 1);
});

test('the noun pack: articles, categories, templates, units and items are checked', () => {
  const r = run(nounPack({
    'nouns/nouns.json': { items: [{ de: 'Hund', g: 'den', em: '🐕', cat: 'tiere' }, { de: 'Hund', g: 'der', em: '', cat: 'zoo' }] },
    'nouns/templates.json': { akk: [{ t: 'Ich sehe den Hund.', cats: ['zoo'] }], dat: [{ t: '%A %N', only: ['Katze'] }] },
    'nouns/path-akk.json': { units: [{ n: 2, title: '', lessonHtml: '<script>x</script>', items: [{ kind: 'pmcq', opts: ['a', 'b'], correct: 'c' }] }] },
  }));
  const m = r.errors.join('\n');
  for (const re of [/must be der, die or das/, /appears twice/, /unknown category "zoo"/, /needs %A and %N/, /"Katze" is not in the noun list/, /numbered 1, 2, 3/, /missing title/, /forbidden markup/, /not among the options/, /needs a sentence and a task/]) assert.match(m, re);
  assert.match(r.warnings.join('\n'), /no picture/);
});

test('the noun pack: a missing file is reported', () => {
  const r = run(nounPack({ 'nouns/pack.json': { id: 'nouns', srs: { intervals: [0, 1] }, files: { nouns: 'nouns.json', categories: 'categories.json', templates: 'nope.json', paths: {}, wortbau: 'wortbau.json' } } }));
  assert.match(r.errors.join('\n'), /nope\.json missing/);
});
