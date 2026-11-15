// FamilySync against a fake in-memory Firestore (REST shapes as the real one).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, keys as K } from '../app/core/storage.js';
import { createFamilySync, ruleFor, SNAPSHOT_MAX_BYTES } from '../app/core/sync.js';

const P = 'Testkind';
const FAM = 'testfam';   // a fake family code, deliberately short (the scan flags real-looking ones)

function fakeFirestore() {
  const docs = new Map();   // 'families/<fam>/stores/<key>' → fields
  const calls = [];
  let failNext = 0;
  const refuse = new Set();   // document paths the cloud answers with 403
  const hooks = { beforeGet: null };
  const name = path => `projects/x/databases/(default)/documents/${path}`;
  async function fetch(url, init = {}) {
    const u = new URL(url);
    const method = init.method || 'GET';
    const path = u.pathname.replace(/^.*\/documents\//, '').split('/').map(decodeURIComponent).join('/');
    calls.push({ method, path, keepalive: !!init.keepalive });
    if (failNext > 0) { failNext--; return { ok: false, status: 503, json: async () => ({}) }; }
    if (refuse.has(path)) return { ok: false, status: 403, json: async () => ({}) };
    if (method === 'GET' && hooks.beforeGet) await hooks.beforeGet(path);
    const segs = path.split('/');
    if (method === 'GET' && segs.length % 2 === 1) {       // collection → list
      const prefix = path + '/';
      const documents = [...docs].filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
        .map(([p, fields]) => ({ name: name(p), fields }));
      return { ok: true, status: 200, json: async () => ({ documents }) };
    }
    if (method === 'GET') {
      if (!docs.has(path)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ name: name(path), fields: docs.get(path) }) };
    }
    if (method === 'PATCH') {
      docs.set(path, JSON.parse(init.body).fields);
      return { ok: true, status: 200, json: async () => ({ name: name(path), fields: docs.get(path) }) };
    }
    if (method === 'DELETE') { docs.delete(path); return { ok: true, status: 200, json: async () => ({}) }; }
    return { ok: false, status: 400, json: async () => ({}) };
  }
  const storeDoc = (key, json, ts, extra = {}) => docs.set(`families/${FAM}/stores/${key}`,
    { json: { stringValue: json }, ts: { integerValue: String(ts) }, ...extra });
  const tombstone = (key, ts) => docs.set(`families/${FAM}/stores/${key}`, { deleted: { booleanValue: true }, ts: { integerValue: String(ts) } });
  const read = key => { const f = docs.get(`families/${FAM}/stores/${key}`); return f ? { json: f.json?.stringValue ?? null, ts: Number(f.ts.integerValue), deleted: f.deleted?.booleanValue === true } : null; };
  return { fetch, docs, calls, storeDoc, tombstone, read, fail: n => { failNext = n; }, hooks,
    refuse: key => refuse.add(`families/${FAM}/stores/${key}`), refuseSnapshots: day => refuse.add(`families/${FAM}/snapshots/${day}`) };
}

function harness({ local = {}, family = FAM, fs = fakeFirestore(), day = '2026-10-18', namespace = '', wrap = be => be } = {}) {
  const be = wrap(memoryBackend({ ...(family ? { family_sync_id: family } : {}), ...local }));
  const events = [];
  const errors = [];
  const timers = { pending: [], set(f) { this.pending.push(f); return this.pending.length; }, clear(id) { this.pending[id - 1] = null; } };
  const flushTimers = async () => { const p = timers.pending.splice(0); for (const f of p) if (f) await f(); };
  const logs = [];
  let clock = 1_000_000;
  const store = createStore({ backend: be, namespace, onDirty: k => sync.markDirty(k), onRemove: k => sync.remove(k) });
  const sync = createFamilySync({
    store, fetch: fs.fetch, now: () => (clock += 1000), today: () => day,
    location: { search: '', pathname: '/index.html', hash: '' }, history: { replaceState() {} }, document: null,
    dispatch: (n, d) => events.push({ n, d }), timers, log: { warn: (...a) => logs.push(a.join(' ')) },
    onError: e => errors.push(e.message),
  });
  return { be, store, sync, fs, events, errors, timers, flushTimers, logs, setDay: d => { day = d; } };
}

const srsRaw = o => JSON.stringify(o);

test('ruleFor follows the registry; device-local keys have no rule', () => {
  assert.equal(typeof ruleFor(K.quizSrs(P)), 'function');
  assert.equal(typeof ruleFor(K.familyProfiles()), 'function');
  assert.equal(ruleFor(K.familyId()), null);
  assert.equal(ruleFor('wq_editor_QB_ver'), null);
  assert.equal(ruleFor('unknown'), null);
});

test('disabled without a family code; never exposes the code; refuses a namespaced store', () => {
  const h = harness({ family: null });
  assert.equal(h.sync.enabled, false);
  assert.equal(h.sync.hasFamily, false);
  assert.equal(h.sync.init(), false);
  assert.equal(h.sync.status, 'aus');
  assert.equal(h.sync.familyId, undefined);
  const staging = harness({ namespace: 'next_', local: { next_family_sync_id: FAM } });
  assert.equal(staging.sync.enabled, false);
  const h2 = harness();
  assert.equal(h2.sync.enabled, true);
  assert.equal(h2.sync.hasFamily, true);
});

test('the family code is taken from ?familie=, stored, and scrubbed from the address bar', () => {
  const be = memoryBackend();
  const store = createStore({ backend: be });
  let replaced = null;
  const sync = createFamilySync({ store, fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    location: { search: `?familie=${FAM}&profil=A`, pathname: '/index.html', hash: '#x' },
    history: { replaceState: (_, __, url) => { replaced = url; } }, document: null, dispatch() {}, log: { warn() {} } });
  assert.equal(sync.enabled, true);
  assert.equal(be.getItem('family_sync_id'), FAM);
  assert.equal(replaced, '/index.html?profil=A#x');
});

test('pull merges cloud data into local by rule and pushes the merged result back', async () => {
  const h = harness({ local: { [K.quizSrs(P)]: srsRaw({ q1: { b: 1, due: '2026-10-10', s: 2 }, q2: { b: 1, due: '2026-10-10', s: 1 } }) } });
  h.fs.storeDoc(K.quizSrs(P), srsRaw({ q1: { b: 3, due: '2026-10-20', s: 5 }, q3: { b: 0, due: '2026-10-18', s: 1 } }), 500);
  h.fs.storeDoc('unknown_key', '{"x":1}', 500);
  h.fs.storeDoc(K.gramSound(), 'true', 500);          // device-local key in the cloud: ignored
  await h.sync.pullAll();
  assert.equal(h.sync.status, 'ok');
  const merged = h.store.get(K.quizSrs(P));
  assert.deepEqual(Object.keys(merged).sort(), ['q1', 'q2', 'q3']);
  assert.equal(merged.q1.s, 5);
  assert.equal(h.store.has('unknown_key'), false);
  assert.equal(h.store.has(K.gramSound()), false);
  assert.ok(h.events.some(e => e.n === 'familysync-pulled' && e.d.keys.includes(K.quizSrs(P))));
  // the merge produced news (q2) for the cloud: pushed after the debounce
  assert.equal(h.sync.dirtyCount, 1);
  await h.flushTimers();
  assert.deepEqual(Object.keys(JSON.parse(h.fs.read(K.quizSrs(P)).json)).sort(), ['q1', 'q2', 'q3']);
  assert.equal(h.sync.dirtyCount, 0);
});

test('first start: local keys the cloud lacks are pushed; nothing device-local goes up', async () => {
  const h = harness({ local: { [K.gramSrs(P)]: '{"Apfel":{"b":1,"due":"2026-10-10","s":1}}', [K.gramSound()]: 'true', [K.appSettings()]: '{}' } });
  h.sync.init();
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  await h.flushTimers();
  assert.ok(h.fs.read(K.gramSrs(P)));
  assert.equal(h.fs.read(K.gramSound()), null);
  assert.equal(h.fs.read(K.appSettings()), null);
  assert.equal(h.fs.read(K.familyId()), null);
});

test('a remote tombstone deletes the local copy unless it has unsaved local changes', async () => {
  const h = harness({ local: { [K.wrHigh(P)]: '120', [K.wrStats(P)]: '{"a":{"ts":1}}' } });
  h.fs.tombstone(K.wrHigh(P), 900);
  h.fs.tombstone(K.wrStats(P), 900);
  h.store.set(K.wrStats(P), { a: { ts: 1 }, b: { ts: 2 } });   // dirty → survives
  await h.sync.pullAll();
  assert.equal(h.store.has(K.wrHigh(P)), false);
  assert.equal(h.store.has(K.wrStats(P)), true);
  await h.flushTimers();
  assert.equal(h.fs.read(K.wrStats(P)).deleted, false);        // revived in the cloud by the push
});

test('a local deletion travels as a tombstone; newer cloud data wins over an older tombstone', async () => {
  const h = harness({ local: { [K.gramBadges(P)]: '{"early":"2026-10-01"}' } });
  h.fs.storeDoc(K.gramBadges(P), '{"early":"2026-10-01"}', 500);
  h.store.remove(K.gramBadges(P));
  assert.equal(h.store.has(K.gramBadges(P)), false);
  await h.flushTimers();
  assert.equal(h.fs.read(K.gramBadges(P)).deleted, true);
  // another device writes newer data after our deletion → the data wins and revives locally
  h.fs.storeDoc(K.gramBadges(P), '{"early":"2026-10-01","zoo":"2026-10-19"}', 5_000_000);
  h.store.remove(K.gramBadges(P));
  await h.flushTimers();
  assert.deepEqual(h.store.get(K.gramBadges(P)), { early: '2026-10-01', zoo: '2026-10-19' });
  assert.equal(h.fs.read(K.gramBadges(P)).deleted, false);
});

test('pull: an older cloud copy does not revive a key deleted locally after it', async () => {
  const h = harness({ local: { [K.gramBadges(P)]: '{"early":"x"}' } });
  h.fs.storeDoc(K.gramBadges(P), '{"early":"x"}', 500);
  h.store.remove(K.gramBadges(P));                              // tombstone ts ≈ 1_001_000 > 500
  await h.sync.pullAll();
  assert.equal(h.store.has(K.gramBadges(P)), false);
  await h.flushTimers();
  assert.equal(h.fs.read(K.gramBadges(P)).deleted, true);
});

test('push merges with the cloud copy before writing; flush skips reads and uses keepalive', async () => {
  const h = harness();
  h.fs.storeDoc(K.quizStats(P), '{"q1":{"shown":5,"correct":4}}', 500);
  h.store.set(K.quizStats(P), { q1: { shown: 3, correct: 1 }, q2: { shown: 1, correct: 1 } });
  await h.flushTimers();
  assert.deepEqual(JSON.parse(h.fs.read(K.quizStats(P)).json), { q1: { shown: 5, correct: 4 }, q2: { shown: 1, correct: 1 } });
  await h.sync.pullAll();
  h.fs.calls.length = 0;
  h.store.set(K.quizStats(P), { q1: { shown: 6, correct: 4 }, q2: { shown: 1, correct: 1 } });
  h.store.set(K.wrHigh(P), 12);
  await h.sync.pushDirty(true);
  assert.deepEqual(h.fs.calls.map(c => c.method), ['PATCH', 'PATCH'], 'no reads, every key sent at once');
  assert.ok(h.fs.calls.every(c => c.keepalive));
});

test('an unload flush never writes before this page has merged with the cloud once', async () => {
  // a phone that was away for weeks: 1 card here, 3 in the cloud, and the pull fails (offline)
  const h = harness({ local: { [K.quizSrs(P)]: srsRaw({ q1: { b: 1, due: '2026-10-10', s: 1 } }) } });
  const cloud = srsRaw({ q1: { b: 3, due: '2026-10-20', s: 5 }, q2: { b: 2, due: '2026-10-19', s: 3 }, q3: { b: 1, due: '2026-10-18', s: 1 } });
  h.fs.storeDoc(K.quizSrs(P), cloud, 500);
  h.fs.fail(1);
  await h.sync.pullAll();
  assert.equal(h.sync.status, 'offline');
  h.store.set(K.quizSrs(P), { q1: { b: 2, due: '2026-10-25', s: 2 } });
  await h.sync.pushDirty(true);                       // the page is hidden
  assert.equal(h.fs.read(K.quizSrs(P)).json, cloud, 'the cloud copy is untouched');
  // back online: the pull merges, and the answer given offline still goes up
  await h.sync.pullAll();
  await h.flushTimers();
  const up = JSON.parse(h.fs.read(K.quizSrs(P)).json);
  assert.deepEqual(Object.keys(up).sort(), ['q1', 'q2', 'q3']);
  assert.equal(up.q1.s, 5);
});

test('an answer saved while the push waits for the cloud is not overwritten', async () => {
  const h = harness();
  h.fs.storeDoc(K.quizStats(P), '{"q9":{"shown":2,"correct":2,"wrong":0}}', 500);
  h.store.set(K.quizStats(P), { q1: { shown: 1, correct: 1, wrong: 0 } });
  let once = true;
  h.fs.hooks.beforeGet = async path => {
    if (!once || !path.endsWith(K.quizStats(P))) return;
    once = false;
    h.store.set(K.quizStats(P), { q1: { shown: 2, correct: 2, wrong: 0 }, q2: { shown: 1, correct: 0, wrong: 1 } });
  };
  await h.flushTimers();
  const want = { q1: { shown: 2, correct: 2, wrong: 0 }, q2: { shown: 1, correct: 0, wrong: 1 }, q9: { shown: 2, correct: 2, wrong: 0 } };
  assert.deepEqual(h.store.get(K.quizStats(P)), want);
  await h.flushTimers();
  assert.deepEqual(JSON.parse(h.fs.read(K.quizStats(P)).json), want);
});

test('one entry that cannot be merged or written does not stop the others; it is reported once', async () => {
  // the device refuses to store one key (storage full for that value)
  const bad = K.gramSrs(P);
  const h = harness({
    local: { [bad]: srsRaw({ Apfel: { b: 1, due: '2026-10-10', s: 1 } }), [K.wrHigh(P)]: '5' },
    wrap: be => ({ ...be, get length() { return be.length; }, setItem: (k, v) => { if (k === bad) throw new Error('QuotaExceededError'); be.setItem(k, v); } }),
  });
  h.fs.storeDoc(bad, srsRaw({ Birne: { b: 2, due: '2026-10-12', s: 2 } }), 500);
  h.fs.storeDoc(K.wrHigh(P), '40', 500);
  h.fs.storeDoc(K.quizStats(P), '{"q1":{"shown":1,"correct":1,"wrong":0}}', 500);
  await h.sync.pullAll();
  assert.equal(h.sync.status, 'ok');
  assert.equal(h.store.get(K.wrHigh(P)), 40, 'the key after the odd one is merged');
  assert.ok(h.store.has(K.quizStats(P)));
  assert.deepEqual(Object.keys(h.store.get(bad)), ['Apfel'], 'the local copy of the odd key is untouched');
  assert.equal(h.errors.length, 1);
  await h.sync.pullAll();
  assert.equal(h.errors.length, 1, 'reported once per page, not on every pull');
  assert.ok(h.errors.every(m => !m.includes(FAM)));
});

test('a document the cloud refuses stays dirty; the other keys still go up', async () => {
  const h = harness();
  await h.sync.pullAll();
  h.fs.refuse(K.quizStats(P));
  h.store.set(K.quizStats(P), { q1: { shown: 1, correct: 1, wrong: 0 } });
  h.store.set(K.wrHigh(P), 77);
  await h.flushTimers();
  assert.equal(h.fs.read(K.wrHigh(P)).json, '77');
  assert.equal(h.sync.status, 'offline');
  assert.equal(h.sync.dirtyCount, 1);
  assert.equal(h.errors.length, 1);
});

test('a cloud that refuses the daily snapshot is reported to the error log', async () => {
  const h = harness({ local: { [K.wrHigh(P)]: '7' } });
  h.fs.refuseSnapshots('2026-10-18');
  await h.sync.pullAll();
  assert.equal(h.sync.status, 'ok');
  assert.equal(h.errors.length, 1);
  assert.match(h.errors[0], /Sicherung/);
});

test('two devices: per-module day counters reach both (plan_days is merged in depth)', async () => {
  const fs = fakeFirestore();
  const day = '2026-10-18';
  const a = harness({ fs }), b = harness({ fs });
  await a.sync.pullAll(); await b.sync.pullAll();
  a.store.set(K.planDays(P), { [day]: { a: 6, c: 5, n: 6, by: { whales: { a: 6, c: 5, n: 6 } } } });
  b.store.set(K.planDays(P), { [day]: { a: 3, c: 3, n: 3, by: { nouns: { a: 3, c: 3, n: 3 } } } });
  for (let i = 0; i < 2; i++) for (const d of [a, b]) { await d.flushTimers(); await d.sync.pullAll(); await d.flushTimers(); }
  const want = { [day]: { a: 6, c: 5, n: 6, by: { whales: { a: 6, c: 5, n: 6 }, nouns: { a: 3, c: 3, n: 3 } } } };
  assert.deepEqual(a.store.get(K.planDays(P)), want);
  assert.deepEqual(b.store.get(K.planDays(P)), want);
  assert.equal(a.sync.dirtyCount + b.sync.dirtyCount, 0, 'settled: nothing left to push');
});

test('a failing cloud sets status offline and keeps the dirty keys for later', async () => {
  const h = harness();
  h.store.set(K.wrHigh(P), 99);
  h.fs.fail(1);
  await h.flushTimers();
  assert.equal(h.sync.status, 'offline');
  assert.equal(h.sync.dirtyCount, 1);
  await h.sync.pushDirty();
  assert.equal(h.sync.status, 'ok');
  assert.equal(h.fs.read(K.wrHigh(P)).json, '99');
  assert.ok(h.logs.every(l => !l.includes(FAM)), 'the family code never appears in a log line');
});

test('export and import: only synced keys, merged on import, then pushed', async () => {
  const h = harness({ local: { [K.wrHigh(P)]: '50', [K.gramSound()]: 'true' } });
  const payload = h.sync.exportAll();
  assert.deepEqual(Object.keys(payload.data), [K.wrHigh(P)]);
  const other = harness({ local: { [K.wrHigh(P)]: '80' } });
  assert.equal(other.sync.importAll(JSON.stringify(payload)), 1);
  assert.equal(other.store.get(K.wrHigh(P)), 80);
  assert.throws(() => other.sync.importAll('{"nope":1}'), /Backup/);
  await other.flushTimers();
  assert.equal(other.fs.read(K.wrHigh(P)).json, '80');
});

test('snapshots: one per day after a pull, listed, restored, pruned', async () => {
  const h = harness({ local: { [K.quizSrs(P)]: srsRaw({ q1: { b: 2, due: '2026-10-10', s: 3 } }), [K.wrHigh(P)]: '7' } });
  await h.sync.pullAll();
  assert.equal(h.fs.calls.filter(c => c.method === 'PATCH' && c.path.includes('/snapshots/')).length, 1);
  await h.sync.pullAll();
  assert.equal(h.fs.calls.filter(c => c.method === 'PATCH' && c.path.includes('/snapshots/')).length, 1, 'no second snapshot the same day');
  assert.deepEqual((await h.sync.listSnapshots()).map(s => s.day), ['2026-10-18']);
  const snap = await h.sync.getSnapshot('2026-10-18');
  assert.deepEqual(Object.keys(snap.data).sort(), [K.wrHigh(P), K.quizSrs(P)].sort());
  assert.equal(snap.data[K.familyId()], undefined);
  await h.flushTimers();
  // later: one key was lost on the device and in the cloud, the other moved on
  h.be.removeItem(K.wrHigh(P));
  h.fs.docs.delete(`families/${FAM}/stores/${K.wrHigh(P)}`);
  h.store.set(K.quizSrs(P), { q1: { b: 4, due: '2026-11-01', s: 6 }, q2: { b: 1, due: '2026-10-20', s: 1 } });
  await h.flushTimers();
  // bringing the snapshot back refills what is missing, never lowers newer progress, and is in the cloud at once
  assert.deepEqual(await h.sync.restoreSnapshot('2026-10-18'), { n: 2, changed: 1, pushed: true });
  assert.equal(h.store.get(K.wrHigh(P)), 7);
  assert.equal(h.fs.read(K.wrHigh(P)).json, '7');
  assert.equal(h.store.get(K.quizSrs(P)).q1.s, 6);
  assert.deepEqual(Object.keys(JSON.parse(h.fs.read(K.quizSrs(P)).json)).sort(), ['q1', 'q2']);
  assert.equal(h.sync.dirtyCount, 0);
  await assert.rejects(() => h.sync.restoreSnapshot('2020-01-01'), /nicht gefunden/);
  // pruning keeps the last N
  for (const d of ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22']) { h.setDay(d); await h.sync.maybeSnapshot(); }
  const sync2 = createFamilySync({ store: h.store, fetch: h.fs.fetch, today: () => '2026-10-23', snapshotKeep: 3, dispatch() {}, log: { warn() {} }, timers: h.timers, document: null, location: { search: '' } });
  await sync2.maybeSnapshot();
  assert.deepEqual((await sync2.listSnapshots()).map(s => s.day), ['2026-10-21', '2026-10-22', '2026-10-23']);
});

test('snapshots leave out the old editor banks when too big, and say so', async () => {
  const big = JSON.stringify({ kap01: [{ id: 'x', text: 'y'.repeat(SNAPSHOT_MAX_BYTES) }] });
  const h = harness({ local: { wq_editor_QB_book: big, [K.wrHigh(P)]: '3' } });
  assert.equal(await h.sync.maybeSnapshot(), true);
  const snap = await h.sync.getSnapshot('2026-10-18');
  assert.deepEqual(snap.trimmed, ['wq_editor_QB_book']);
  assert.deepEqual(Object.keys(snap.data), [K.wrHigh(P)]);
});

test('status events are dispatched; pulled events name the keys', async () => {
  const h = harness();
  h.fs.storeDoc(K.wrHigh(P), '42', 500);
  await h.sync.pullAll();
  assert.deepEqual(h.events.filter(e => e.n === 'familysync-status').map(e => e.d.status), ['sync', 'ok']);
  assert.deepEqual(h.events.find(e => e.n === 'familysync-pulled').d.keys, [K.wrHigh(P)]);
});
