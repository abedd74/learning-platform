// The id freeze (DESIGN §5.2, MIGRATION rule 5): every question the old app
// had keeps exactly its id, in its topic and order, so every child's progress
// (wq_srs_<P>, wq_stats_<P>) keeps pointing at the right question. Content may
// GROW — new modules, topics and questions — and every id published since is
// held by the ledger (tools/ids-ledger.mjs). The nouns keep their spelling
// (keys of gram_srs_<P>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import golden from './fixtures/live-ids.json' with { type: 'json' };
import { contentIds, readLedger } from '../tools/ids-ledger.mjs';

const read = rel => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8'));
const TYPE_MAP = { mcq: 'choice', multiselect: 'multi', truefalse: 'bool', fitb: 'text', sequence: 'order', dragmatch: 'pairs', imageChoice: 'image', cycleDiagram: 'cycle' };

/** Is `part` contained in `whole` in the same order (other entries may sit in between)? */
const inOrder = (part, whole) => { let i = 0; for (const x of whole) if (i < part.length && x === part[i]) i++; return i === part.length; };

for (const [moduleId, g] of Object.entries(golden.quiz)) {
  test(`${moduleId}: every id of the live app is still there, in its topic and order (new topics and questions may join)`, () => {
    assert.ok(existsSync(new URL(`../content/${moduleId}/module.json`, import.meta.url)), `content/${moduleId}/module.json missing`);
    const mod = read(`content/${moduleId}/module.json`);
    assert.equal(mod.idPrefix, g.idPrefix);
    assert.equal(mod.legacyStorageKey, g.storageKey);
    assert.ok(inOrder(g.tkeys, mod.topics.map(t => t.id)), `${moduleId}: an old topic is missing or out of order`);
    for (const tkey of g.tkeys) {
      const t = mod.topics.find(x => x.id === tkey);
      const items = read(`content/${moduleId}/${t.file}`).items;
      const want = g.topics[tkey] || [];
      assert.ok(inOrder(want.map(q => q.id), items.map(q => q.id)), `${moduleId}/${tkey}: an old id is missing or out of order`);
      const typeOf = Object.fromEntries(items.map(q => [q.id, q.type]));
      for (const q of want) assert.equal(typeOf[q.id], TYPE_MAP[q.type], `${moduleId}/${tkey}/${q.id} type`);
    }
  });
}

test('every live id appears exactly once in content, and no id is used twice', () => {
  const now = contentIds();
  const all = Object.values(now).flatMap(m => Object.keys(m));
  assert.equal(new Set(all).size, all.length, 'an id is used by two questions');
  const live = Object.values(golden.quiz).flatMap(g => Object.values(g.topics).flat().map(q => q.id));
  assert.equal(live.length, golden.counts.total);
  for (const id of live) assert.equal(all.filter(x => x === id).length, 1, id);
});

test('the ledger: a published id never disappears, moves to another module or changes its kind (run: npm run ledger)', () => {
  const ledger = readLedger();
  const now = contentIds();
  for (const [m, ids] of Object.entries(ledger.modules)) for (const [id, type] of Object.entries(ids)) {
    assert.ok(now[m] && id in now[m], `published id "${id}" is gone from ${m} — a child's progress on it would be orphaned`);
    assert.equal(now[m][id], type, `published id "${id}" changed its type`);
  }
  for (const [m, ids] of Object.entries(now)) for (const id of Object.keys(ids)) {
    assert.ok(ledger.modules[m] && id in ledger.modules[m], `new question "${id}" in ${m} is not in the ledger yet — run: npm run ledger`);
    assert.ok(!id.includes(':'), `"${id}": a question id must not contain ":"`);
  }
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
