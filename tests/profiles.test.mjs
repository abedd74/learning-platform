import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, keys as K } from '../app/core/storage.js';
import {
  validKey, keyFromName, listProfiles, getProfile, saveProfile, removeProfile, detectLegacyProfiles,
  legacyCustomProfiles, legacyLastProfile, currentProfileKey, setCurrentProfile, PARENT_KEY,
  adoptLegacyProfiles, PROVISIONAL, AVATARS, ADOPTED, parseOldProfiles, completeFromOldApp,
} from '../app/core/profiles.js';
import { mergeProfiles } from '../app/core/merges.js';

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

test('old progress on the device: its names become profiles at once, nothing to set up', () => {
  const s = fresh({
    [K.gramSrs('Beta')]: '{}', [K.wrHigh('Beta')]: '5',
    [K.quizHistory('Alpha')]: '[]', [K.quizSrs('Alpha')]: '{"q1":{"b":3,"due":"2026-11-20"}}',
    [K.quizHistory(PARENT_KEY)]: '[]', [K.quizStats('has space')]: '{}',
  });
  const made = adoptLegacyProfiles(s);
  assert.deepEqual(made.map(p => [p.key, p.name, p.avatar, p.grade]), [['Alpha', 'Alpha', AVATARS[0], null], ['Beta', 'Beta', AVATARS[1], null]]);
  assert.deepEqual(listProfiles(s).map(p => p.key), ['Alpha', 'Beta']);
  // provisional: anything a parent saves on purpose is newer
  assert.ok(listProfiles(s).every(p => p.updatedAt === PROVISIONAL && p.createdAt === PROVISIONAL));
  // the progress itself is not touched, and a second run finds nothing new
  assert.equal(s.getRaw(K.quizSrs('Alpha')), '{"q1":{"b":3,"due":"2026-11-20"}}');
  assert.deepEqual(adoptLegacyProfiles(s), []);
  assert.deepEqual(detectLegacyProfiles(s), []);
});

test('adoption keeps what is there: existing and removed profiles stay, old extra profiles keep their picture', () => {
  const s = fresh({
    [K.gramSrs('Alpha')]: '{}', [K.gramSrs('Beta')]: '{}', [K.gramSrs('Gamma')]: '{}', [K.wrHigh('OmaLu')]: '3',
    custom_profiles: '[{"name":"Oma Lu","avatar":"🌱"},{"name":"Delta","avatar":"🦊"}]',
  });
  saveProfile(s, { name: 'Alpha', avatar: AVATARS[0], grade: 4 }, 5000);
  saveProfile(s, { name: 'Gamma' }, 5000);
  removeProfile(s, 'Gamma', 6000);
  const made = adoptLegacyProfiles(s);
  assert.deepEqual(made.map(p => [p.key, p.name, p.avatar]), [['Beta', 'Beta', AVATARS[1]], ['Delta', 'Delta', '🦊'], ['OmaLu', 'Oma Lu', '🌱']]);
  assert.equal(getProfile(s, 'Alpha').grade, 4);
  assert.equal(getProfile(s, 'Alpha').updatedAt, 5000);
  assert.equal(getProfile(s, 'Gamma'), null);          // a profile a parent removed does not come back
  assert.deepEqual(adoptLegacyProfiles(fresh()), []);  // a new device: nothing to adopt
});

// the old page's table, in its own layout (the names here are made up)
const OLD_PAGE = `<script>
const PROFILES = {
  // Alpha startet im August in der 4. Klasse
  alpha: { name: 'Alpha', avatar: '🦊', grade: 4 },
  beta:  { name: 'Beta',  avatar: '🐢', grade: 2 },   // ab August in der 2. Klasse
  parent: { name: 'Eltern', avatar: '👨‍👩‍👧', grade: null },
};
const OTHER = { name: 'Nope', avatar: 'x', grade: 9 };
</script>`;

test('the old app\'s page yields each child\'s picture and class', () => {
  assert.deepEqual(parseOldProfiles(OLD_PAGE), [
    { name: 'Alpha', avatar: '🦊', grade: 4 }, { name: 'Beta', avatar: '🐢', grade: 2 }, { name: 'Eltern', avatar: '👨‍👩‍👧', grade: null },
  ]);
  assert.deepEqual(parseOldProfiles('<html>the new shell</html>'), []);
  assert.deepEqual(parseOldProfiles(null), []);
});

test('found profiles are completed from the old app: class and picture as before, nothing to set up', () => {
  const s = fresh({ [K.gramSrs('Alpha')]: '{}', [K.wrHigh('Beta')]: '5', [K.wrHigh('Gamma')]: '1', [K.quizStats('Delta')]: '{}' });
  saveProfile(s, { name: 'Delta', avatar: '⭐', grade: 3 }, 5000);          // a parent's own entry
  adoptLegacyProfiles(s);
  const changed = completeFromOldApp(s, parseOldProfiles(OLD_PAGE));
  assert.deepEqual(changed.map(p => p.key), ['Alpha', 'Beta', 'Gamma']);
  assert.deepEqual(listProfiles(s).map(p => [p.key, p.avatar, p.grade, p.updatedAt]), [
    ['Alpha', '🦊', 4, ADOPTED], ['Beta', '🐢', 2, ADOPTED],
    ['Gamma', AVATARS[2], null, ADOPTED],        // the old app did not know this one: kept as found, checked once
    ['Delta', '⭐', 3, 5000],                     // never touched
  ]);
  assert.equal(getProfile(s, 'Eltern'), null, 'the parents are a mode, never a profile');
  assert.deepEqual(completeFromOldApp(s, parseOldProfiles(OLD_PAGE)), [], 'once');
  // between devices: the completed entry beats a bare found one, a parent's entry beats both
  const bare = fresh({ [K.gramSrs('Alpha')]: '{}' }); adoptLegacyProfiles(bare);
  const a = s.get(K.familyProfiles()), b = bare.get(K.familyProfiles());
  assert.equal(mergeProfiles(a, b).profiles.Alpha.grade, 4);
  assert.equal(mergeProfiles(b, a).profiles.Alpha.grade, 4);
  const parent = { v: 1, profiles: { Alpha: { name: 'Alpha', avatar: '🎈', grade: 5, gentle: true, createdAt: 9000, updatedAt: 9000 } } };
  assert.equal(mergeProfiles(a, parent).profiles.Alpha.grade, 5);
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
