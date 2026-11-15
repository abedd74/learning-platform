// The content loader: retries a shaky connection, gives up at once on a
// missing file, and reads both shapes of a topic file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContent } from '../app/core/content.js';

function server(files, script = {}) {
  const calls = [];
  const fetch = async url => {
    const rel = new URL(url).pathname.replace(/^\/content\//, '');
    calls.push(rel);
    const plan = script[rel]?.shift();
    if (plan === 'down') throw new TypeError('Load failed');
    if (typeof plan === 'number') return { ok: false, status: plan, json: async () => ({}) };
    if (!(rel in files)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => files[rel] };
  };
  const waits = [];
  return { content: createContent({ base: 'https://app.example/content/', fetch, wait: async ms => { waits.push(ms); } }), calls, waits };
}
const mod = { id: 'whales', topics: [{ id: 'arten', file: 'arten.json' }, { id: 'liste', file: 'liste.json' }] };

test('a shaky connection gets three tries, then the file is there', async () => {
  const s = server({ 'index.json': { modules: [{ id: 'whales', kind: 'quiz' }] } }, { 'index.json': ['down', 503] });
  assert.deepEqual(await s.content.index(), [{ id: 'whales', kind: 'quiz' }]);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(s.waits, [400, 1600]);
});

test('after three failed tries the error names the file; the next call tries again', async () => {
  const s = server({ 'index.json': { modules: [] } }, { 'index.json': ['down', 'down', 'down'] });
  await assert.rejects(() => s.content.index(), /index\.json/);
  assert.equal(s.calls.length, 3);
  assert.deepEqual(await s.content.index(), []);
});

test('a missing file is final at once, and a missing module reads as "not there"', async () => {
  const s = server({});
  assert.equal(await s.content.module('nope'), null);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.waits, []);
});

test('a topic file may be {items: [...]} or a bare list; questions carry module and topic', async () => {
  const s = server({ 'whales/arten.json': { items: [{ id: 'wal_1', type: 'choice' }] }, 'whales/liste.json': [{ id: 'wal_2', type: 'bool' }] });
  const qs = await s.content.questions(mod);
  assert.deepEqual(qs.map(q => [q.id, q.module, q.topic]), [['wal_1', 'whales', 'arten'], ['wal_2', 'whales', 'liste']]);
});
