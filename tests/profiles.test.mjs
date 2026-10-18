import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, keys as K } from '../app/core/storage.js';
import {
  validKey, keyFromName, listProfiles, getProfile, saveProfile, removeProfile, detectLegacyProfiles,
  legacyCustomProfiles, legacyLastProfile, currentProfileKey, setCurrentProfile, PARENT_KEY,
} from '../app/core/profiles.js';

const fresh = (init = {}) => createStore({ backend: memoryBackend(init), log: { warn() {} } });

test('storage names: letters, digits, _ and -, no spaces, never the parent key', () => {
  assert.ok(validKey('Zoë'));
  assert.ok(validKey('Kind-2'));
  assert.ok(!validKey('Anna Maria'));
  assert.ok(!validKey(''));
  assert.ok(!validKey(PARENT_KEY));
  assert.ok(!validKey('a'.repeat(25)));
  assert.equal(keyFromName('  Anna Maria! '), 'AnnaMaria');
  assert.equal(keyFromName('Zoë'), 'Zoë');
});

test('create, list, update, soft-delete; progress keys are untouched by a delete', () => {
  const s = fresh({ [K.quizSrs('Mia')]: '{"q":{"b":1}}' });
  const a = saveProfile(s, { name: 'Mia', avatar: '🦊', grade: 3 }, 100);
  assert.deepEqual(a, { key: 'Mia', name: 'Mia', avatar: '🦊', grade: 3, gentle: false, createdAt: 100, updatedAt: 100 });
  saveProfile(s, { name: 'Ben', grade: '1', gentle: true }, 200);
  assert.deepEqual(listProfiles(s).map(p => p.key), ['Mia', 'Ben']);
  const upd = saveProfile(s, { key: 'Mia', grade: 4 }, 300);
  assert.equal(upd.grade, 4);
  assert.equal(upd.avatar, '🦊');
  assert.equal(upd.createdAt, 100);
  assert.equal(upd.updatedAt, 300);
  assert.equal(getProfile(s, 'Ben').gentle, true);
  assert.equal(getProfile(s, 'Ben').grade, 1);
  assert.ok(removeProfile(s, 'Ben', 400));
  assert.equal(getProfile(s, 'Ben'), null);
  assert.deepEqual(listProfiles(s).map(p => p.key), ['Mia']);
  assert.ok(!removeProfile(s, 'Nobody'));
  assert.ok(s.has(K.quizSrs('Mia')));
  assert.equal(s.get(K.familyProfiles()).profiles.Ben.deleted, true);   // soft-deleted, synced as such
});

test('invalid names and grades are refused or normalised', () => {
  const s = fresh();
  const ab = saveProfile(s, { name: 'A B' });          // the space leaves the key, not the display name
  assert.equal(ab.key, 'AB');
  assert.equal(ab.name, 'A B');
  assert.throws(() => saveProfile(s, { name: '!!!' }), /Ungültiger/);
  assert.throws(() => saveProfile(s, { name: PARENT_KEY }), /Ungültiger/);
  assert.throws(() => saveProfile(s, { key: 'has space', name: 'x' }), /Ungültiger/);
  assert.equal(saveProfile(s, { name: 'Lu', grade: 9 }).grade, null);
  assert.equal(saveProfile(s, { name: 'Lu', grade: '' }).grade, null);
});

test('the display name may differ from the storage name', () => {
  const s = fresh();
  const p = saveProfile(s, { key: 'Kind1', name: 'Anna Maria', avatar: '⭐' });
  assert.equal(p.key, 'Kind1');
  assert.equal(p.name, 'Anna Maria');
});

test('legacy detection: names from progress keys, with hints, excluding Eltern and known profiles', () => {
  const s = fresh({
    [K.quizHistory('Alpha')]: '[]', [K.quizStats('Alpha')]: '{}', [K.gramSrs('Alpha')]: '{}',
    [K.gramSrs('Beta')]: '{}', [K.wrHigh('Beta')]: '5',
    [K.quizHistory(PARENT_KEY)]: '[]',
    [K.wrHigh('Gamma')]: '1',
    wq_editor_QB_book: '{}', family_sync_id: 'x', [K.quizStats('has space')]: '{}',
  });
  saveProfile(s, { name: 'Gamma' });
  assert.deepEqual(detectLegacyProfiles(s), [
    { key: 'Alpha', quiz: true, trainer: true, game: false },
    { key: 'Beta', quiz: false, trainer: true, game: true },
  ]);
});

test('legacy custom profiles and the old trainer profile are read for the first run', () => {
  const s = fresh({ custom_profiles: '[{"name":"Oma Lu","avatar":"🌱"},{"name":"","avatar":"x"}]', gram_lastProfile: '"Alpha"' });
  assert.deepEqual(legacyCustomProfiles(s), [{ key: 'OmaLu', name: 'Oma Lu', avatar: '🌱' }]);
  assert.equal(legacyLastProfile(s), 'Alpha');
  const raw = fresh({ gram_lastProfile: 'Beta' });
  assert.equal(legacyLastProfile(raw), 'Beta');
  assert.equal(legacyLastProfile(fresh()), null);
});

test('the device remembers its current profile only while that profile exists', () => {
  const s = fresh();
  assert.equal(currentProfileKey(s), null);
  saveProfile(s, { name: 'Mia' });
  setCurrentProfile(s, 'Mia');
  assert.equal(currentProfileKey(s), 'Mia');
  assert.throws(() => setCurrentProfile(s, 'Nobody'), /Unbekannt/);
  removeProfile(s, 'Mia');
  assert.equal(currentProfileKey(s), null);
  setCurrentProfile(s, null);
  assert.equal(s.has(K.appProfile()), false);
});

test('a corrupt family_profiles value is treated as empty', () => {
  const s = fresh({ family_profiles: '{"profiles":"nope"}' });
  assert.deepEqual(listProfiles(s), []);
  saveProfile(s, { name: 'Mia' });
  assert.equal(listProfiles(s).length, 1);
});
