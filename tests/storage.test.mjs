import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REGISTRY, keys, keyInfo, isRegistered, profileOf, memoryBackend, createStore } from '../app/core/storage.js';
import golden from './fixtures/live-ids.json' with { type: 'json' };

const P = 'Testkind';

test('every key the old app wrote is registered and resolves to the right entry', () => {
  const expect = {
    [`wq_${P}`]: 'quizHistory', [`wq_stats_${P}`]: 'quizStats', [`wq_srs_${P}`]: 'quizSrs',
    wq_editor_QB: 'editorBank', wq_editor_QB_whales: 'editorBank', wq_editor_QB_ver: 'editorVersion',
    wq_editor_QB_book_ver: 'editorVersion', [`wq_deck_${P}`]: 'quizDeck', custom_profiles: 'customProfiles',
    [`gram_srs_${P}`]: 'gramSrs', [`gram_days_${P}`]: 'gramDays', [`gram_case_${P}`]: 'gramCase',
    [`gram_badges_${P}`]: 'gramBadges', [`gram_path_${P}`]: 'gramPath', gram_lastProfile: 'gramLastProfile',
    gram_sound_on: 'gramSound', gram_it_on: 'gramItalian',
    [`wr_high_${P}`]: 'wrHigh', [`wr_stats_${P}`]: 'wrStats', wr_sound: 'wrSound',
    family_sync_id: 'familyId', family_sync_meta: 'familyMeta', family_sync_tombstones: 'familyTombstones',
    wq_Eltern: 'quizHistory',
  };
  for (const [k, id] of Object.entries(expect)) assert.equal(keyInfo(k)?.id, id, k);
});

test('the golden file uses exactly the storage keys the registry knows', () => {
  for (const m of Object.values(golden.quiz)) {
    if (m.storageKey) assert.equal(keyInfo(m.storageKey)?.id, 'editorBank', m.storageKey);
  }
});

test('builders produce keys that their own pattern recognises', () => {
  for (const e of REGISTRY) {
    const sample = e.build(e.id === 'editorBank' || e.id === 'editorVersion' ? '_book' : P);
    assert.equal(keyInfo(sample)?.id, e.id, `${e.id} → ${sample}`);
  }
  assert.equal(keys.quizSrs(P), `wq_srs_${P}`);
  assert.equal(keys.mapSrs(P), `map_srs_${P}`);
  assert.equal(keys.planDays(P), `plan_days_${P}`);
  assert.equal(keys.plan(P), `plan_${P}`);
});

test('patterns do not overlap: plan_days_<P> is not plan_<P>, wq_stats_ is not history', () => {
  assert.equal(keyInfo(`plan_days_${P}`).id, 'planDays');
  assert.equal(keyInfo(`plan_${P}`).id, 'plan');
  assert.equal(keyInfo(`wq_stats_${P}`).id, 'quizStats');
  assert.equal(keyInfo('wq_editor_QB_magnetism').id, 'editorBank');
  assert.equal(profileOf(`gram_srs_${P}`), P);
  assert.equal(profileOf('family_profiles'), null);
  assert.ok(!isRegistered('something_else'));
  assert.ok(!isRegistered('wq_a b'));   // a name with a space never synced its history
});

test('ids are unique and every synced key names a merge rule', () => {
  const ids = REGISTRY.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of REGISTRY) assert.ok(e.sync === null || typeof e.sync === 'string', e.id);
});

test('get/set/remove: JSON round trip, dirty and remove callbacks, corrupt entries dropped', () => {
  const dirty = [], removed = [];
  const be = memoryBackend({ [`wq_srs_${P}`]: '{not json' });
  const s = createStore({ backend: be, onDirty: k => dirty.push(k), onRemove: k => removed.push(k), log: { warn() {} } });
  assert.deepEqual(s.get(`wq_srs_${P}`, {}), {});          // corrupt → fallback …
  assert.equal(be.getItem(`wq_srs_${P}`), null);          // … and dropped locally
  assert.ok(s.set(`wq_srs_${P}`, { a: { b: 1 } }));
  assert.deepEqual(s.get(`wq_srs_${P}`), { a: { b: 1 } });
  assert.deepEqual(dirty, [`wq_srs_${P}`]);
  s.remove(`wq_srs_${P}`);
  assert.equal(s.has(`wq_srs_${P}`), false);
  assert.deepEqual(removed, [`wq_srs_${P}`]);
  assert.equal(s.get('missing', 'fb'), 'fb');
});

test('unregistered and legacy keys cannot be written', () => {
  const s = createStore({ backend: memoryBackend() });
  assert.throws(() => s.set('my_new_key', 1), /unregistered key/);
  assert.throws(() => s.set('custom_profiles', []), /legacy/);
  assert.throws(() => s.set('wq_editor_QB', {}), /legacy/);
  assert.throws(() => s.remove('wq_editor_QB'), /legacy/);
});

test('a failing backend never throws out of set/get', () => {
  const be = { length: 0, key: () => null, getItem: () => { throw new Error('private mode'); },
    setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
  const s = createStore({ backend: be, log: { warn() {} } });
  assert.equal(s.set(`wq_srs_${P}`, {}), false);
  assert.equal(s.get(`wq_srs_${P}`, 'fb'), 'fb');
});

test('namespace: staging keys never touch live keys; copyFromLive skips the family code', () => {
  const be = memoryBackend({
    [`wq_srs_${P}`]: '{"q":{"b":2}}', [`gram_srs_${P}`]: '{}', family_sync_id: 'SECRET', unknown_key: 'x',
  });
  const live = createStore({ backend: be });
  const next = createStore({ backend: be, namespace: 'next_' });
  assert.equal(next.get(`wq_srs_${P}`), null);
  assert.deepEqual(next.list(), []);
  assert.equal(next.copyFromLive(), 2);
  assert.deepEqual(next.get(`wq_srs_${P}`), { q: { b: 2 } });
  assert.equal(next.has('family_sync_id'), false);
  assert.deepEqual(next.list().sort(), [`gram_srs_${P}`, `wq_srs_${P}`]);
  next.set(`wq_srs_${P}`, { q: { b: 5 } });
  assert.deepEqual(live.get(`wq_srs_${P}`), { q: { b: 2 } });   // live untouched
  assert.ok(live.list().includes('family_sync_id'));
  assert.throws(() => live.copyFromLive(), /namespace/);
});
