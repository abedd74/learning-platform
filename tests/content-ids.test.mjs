// The id freeze (DESIGN §5.2, MIGRATION rule 5): every question in content/
// carries exactly the id the old app gave it, in the same topic and order,
// so every child's progress (wq_srs_<P>, wq_stats_<P>) keeps pointing at the
// right question. The nouns keep their spelling (keys of gram_srs_<P>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import golden from './fixtures/live-ids.json' with { type: 'json' };

const read = rel => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const TYPE_MAP = { mcq: 'choice', multiselect: 'multi', truefalse: 'bool', fitb: 'text', sequence: 'order', dragmatch: 'pairs', imageChoice: 'image', cycleDiagram: 'cycle' };

for (const [moduleId, g] of Object.entries(golden.quiz)) {
  test(`${moduleId}: topics, ids and order equal the live app`, () => {
    assert.ok(existsSync(new URL(`../content/${moduleId}/module.json`, import.meta.url)), `content/${moduleId}/module.json missing`);
    const mod = read(`content/${moduleId}/module.json`);
    assert.equal(mod.idPrefix, g.idPrefix);
    assert.equal(mod.legacyStorageKey, g.storageKey);
    assert.deepEqual(mod.topics.map(t => t.id), g.tkeys);
    for (const t of mod.topics) {
      const items = read(`content/${moduleId}/${t.file}`).items;
      const want = g.topics[t.id] || [];
      assert.deepEqual(items.map(q => q.id), want.map(q => q.id), `${moduleId}/${t.id}`);
      assert.deepEqual(items.map(q => q.type), want.map(q => TYPE_MAP[q.type]), `${moduleId}/${t.id} types`);
    }
  });
}

test('every live id appears exactly once in content', () => {
  const all = [];
  for (const moduleId of Object.keys(golden.quiz)) {
    const mod = read(`content/${moduleId}/module.json`);
    for (const t of mod.topics) all.push(...read(`content/${moduleId}/${t.file}`).items.map(q => q.id));
  }
  assert.equal(all.length, golden.counts.total);
  assert.equal(new Set(all).size, all.length);
});

test('nouns: the same words in the same order as the live trainer', () => {
  const nouns = read('content/nouns/nouns.json').items.map(n => n.de);
  assert.deepEqual(nouns, golden.trainer.nouns);
});

test('Lernpfad courses keep their unit counts (keys of gram_path_<P>)', () => {
  for (const k of ['akk', 'dat', 'nomen']) {
    assert.equal(read(`content/nouns/path-${k}.json`).units.length, golden.trainer.paths[k], k);
  }
});

test('noun intervals are the live trainer intervals', () => {
  assert.deepEqual(read('content/nouns/pack.json').srs.intervals, golden.trainer.intervals);
});
