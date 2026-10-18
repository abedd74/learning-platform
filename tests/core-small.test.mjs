// errors, version, i18n, router, audio
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, memoryBackend, keys as K } from '../app/core/storage.js';
import { scrub, toEntry, createErrorLog } from '../app/core/errors.js';
import { versionFrom, versionedUrl, footerText, FALLBACK_VERSION } from '../app/core/version.js';
import { format, text, createI18n } from '../app/core/i18n.js';
import { parseHash, buildHash, profileFromSearch, createRouter } from '../app/core/router.js';
import { slug, clipName, createAudio } from '../app/core/audio.js';
import { ERROR_LOG_MAX } from '../app/core/merges.js';

const fresh = (init = {}) => createStore({ backend: memoryBackend(init), log: { warn() {} } });
const quiet = { warn() {}, error() {} };

// ── errors ────────────────────────────────────────────────────────────

test('scrub removes family codes from paths, links and literals', () => {
  // fake codes are glued from pieces so that this file itself scans clean
  const code = 'abcdefabcdef' + 'abcdef12';
  assert.equal(scrub(`GET families/${code}/stores failed`), 'GET families/…/stores failed');
  assert.equal(scrub(`open ?familie=${code}&x=1`), 'open ?familie=…&x=1');
  assert.equal(scrub(`family_sync_id = '${code}'`), 'family_sync_id=…');
  assert.equal(scrub('x'.repeat(1000)).length, 600);
});

test('entries carry version, page, message and a short stack', () => {
  const err = new TypeError('boom');
  const e = toEntry(err, { version: '1.2', page: '#/module/whales', now: 5 });
  assert.equal(e.msg, 'TypeError: boom');
  assert.equal(e.v, '1.2');
  assert.equal(e.page, '#/module/whales');
  assert.equal(e.ts, 5);
  assert.ok(e.stack.split('\n').length <= 4);
  assert.equal(toEntry('plain string', { now: 1 }).msg, 'plain string');
  assert.equal(toEntry({ message: 'obj' }, { now: 1 }).msg, 'obj');
});

test('the log records, dedupes within 5 s, caps at 200, counts unseen', () => {
  const s = fresh();
  let t = 1000;
  const log = createErrorLog({ store: s, version: '9', now: () => t, page: () => '#/x', log: quiet });
  log.record(new Error('a'));
  log.record(new Error('a'));                 // same message within 5 s → one entry
  t += 6000;
  log.record(new Error('a'));
  assert.equal(log.list().length, 2);
  assert.equal(log.list()[0].ts, 7000);        // newest first
  for (let i = 0; i < 300; i++) { t += 6000; log.record(new Error('e' + i)); }
  assert.equal(s.get(K.appErrors()).length, ERROR_LOG_MAX);
  assert.equal(log.unseen(), ERROR_LOG_MAX);
  log.markSeen();
  assert.equal(log.unseen(), 0);
  t += 6000; log.record(new Error('late'));
  assert.equal(log.unseen(), 1);
  log.clear();
  assert.deepEqual(log.list(), []);
});

test('install hooks error and unhandledrejection events and can unhook', () => {
  const s = fresh();
  const listeners = {};
  const target = { addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: n => { delete listeners[n]; } };
  const log = createErrorLog({ store: s, now: () => 1, log: quiet });
  const off = log.install(target);
  listeners.error({ error: new Error('win') });
  listeners.unhandledrejection({ reason: new Error('rej') });
  assert.deepEqual(log.list().map(e => e.msg).sort(), ['Error: rej', 'Error: win']);
  off();
  assert.deepEqual(Object.keys(listeners), []);
});

test('a broken store never makes record() throw', () => {
  const be = { length: 0, key: () => null, getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem() {} };
  const log = createErrorLog({ store: createStore({ backend: be, log: quiet }), log: quiet });
  assert.doesNotThrow(() => log.record(new Error('a')));
});

// ── version ───────────────────────────────────────────────────────────

test('version helpers', () => {
  assert.equal(versionFrom({ version: '2026.11.03' }), '2026.11.03');
  assert.equal(versionFrom({ version: 'bad value!' }), FALLBACK_VERSION);
  assert.equal(versionFrom(null), FALLBACK_VERSION);
  assert.equal(versionedUrl('https://x.test/learning-platform/app/', 'main.js', '1.2'), 'https://x.test/learning-platform/app/main.js?v=1.2');
  assert.equal(footerText('1.2', 'ok'), 'v1.2 · Sync ✓');
  assert.equal(footerText(undefined, 'aus'), `v${FALLBACK_VERSION} · Sync aus`);
  assert.equal(footerText('1', 'offline'), 'v1 · Sync offline');
});

// ── i18n ──────────────────────────────────────────────────────────────

test('format fills placeholders and leaves unknown ones', () => {
  assert.equal(format('Hallo, {name}! {n} Punkte', { name: 'Du', n: 3 }), 'Hallo, Du! 3 Punkte');
  assert.equal(format('{missing}', {}), '{missing}');
});

test('content text normalises to {de, it|null}', () => {
  assert.deepEqual(text('Hallo'), { de: 'Hallo', it: null });
  assert.deepEqual(text({ de: 'Hallo', it: 'Ciao' }), { de: 'Hallo', it: 'Ciao' });
  assert.deepEqual(text({ de: 'Hallo', it: '  ' }), { de: 'Hallo', it: null });
  assert.deepEqual(text(null), { de: '', it: null });
});

test('the Italian toggle is a device setting; t/it/pick honour it', () => {
  const s = fresh();
  const i = createI18n({ store: s, strings: { hi: { de: 'Hallo {n}', it: 'Ciao {n}' }, only: 'Nur Deutsch' } });
  assert.equal(i.showItalian, false);
  assert.equal(i.t('hi', { n: 'Mia' }), 'Hallo Mia');
  assert.equal(i.it('hi', { n: 'Mia' }), null);
  assert.deepEqual(i.pick({ de: 'a', it: 'b' }), { de: 'a', it: null });
  i.setShowItalian(true);
  assert.equal(i.showItalian, true);
  assert.equal(i.it('hi', { n: 'Mia' }), 'Ciao Mia');
  assert.equal(i.it('only'), null);
  assert.equal(i.t('unknown.id'), 'unknown.id');
  assert.deepEqual(i.pick({ de: 'a', it: 'b' }), { de: 'a', it: 'b' });
  assert.equal(s.get(K.appSettings()).italian, true);
});

// ── router ────────────────────────────────────────────────────────────

test('hash parsing and building round-trip, with encoding', () => {
  assert.deepEqual(parseHash('#/module/whales?topic=arten&x=1'), { path: ['module', 'whales'], params: { topic: 'arten', x: '1' } });
  assert.deepEqual(parseHash(''), { path: [], params: {} });
  assert.deepEqual(parseHash('#/'), { path: [], params: {} });
  assert.equal(buildHash(['module', 'Deutsch mit Ella'], { t: 'a b', empty: '' }), '#/module/Deutsch%20mit%20Ella?t=a+b');
  assert.deepEqual(parseHash(buildHash(['module', 'Deutsch mit Ella'], { t: 'a b' })), { path: ['module', 'Deutsch mit Ella'], params: { t: 'a b' } });
  assert.equal(buildHash('eltern/errors'), '#/eltern/errors');
});

test('profileFromSearch reads the old ?profil= parameter', () => {
  assert.equal(profileFromSearch('?profil=Zo%C3%AB&x=1'), 'Zoë');
  assert.equal(profileFromSearch('?familie=abc'), null);
  assert.equal(profileFromSearch(''), null);
});

test('the router reports the current route on start and on hash changes', () => {
  const listeners = {};
  const win = { location: { hash: '#/grid' }, history: { replaceState: (_, __, h) => { win.location.hash = h; } },
    addEventListener: (n, f) => { listeners[n] = f; }, removeEventListener: n => { delete listeners[n]; } };
  const seen = [];
  const r = createRouter({ window: win, onChange: route => seen.push(route.path.join('/')) });
  const stop = r.start();
  assert.deepEqual(seen, ['grid']);
  win.location.hash = '#/module/whales'; listeners.hashchange();
  assert.deepEqual(seen, ['grid', 'module/whales']);
  r.navigate(['eltern'], {}, { replace: true });
  assert.deepEqual(seen, ['grid', 'module/whales', 'eltern']);
  assert.deepEqual(r.current.path, ['eltern']);
  r.navigate(['eltern']);                      // same hash: still reported once more
  assert.equal(seen.length, 4);
  stop();
  assert.deepEqual(Object.keys(listeners), []);
});

// ── audio ─────────────────────────────────────────────────────────────

test('clip names follow the old trainer: umlauts expanded, lower case, nothing else', () => {
  assert.equal(slug('Käse'), 'kaese');
  assert.equal(slug('Straße'), 'strasse');
  assert.equal(slug('Öl-Übung 2!'), 'oeluebung2');
  assert.equal(clipName('a', 'Apfel'), 'a_apfel');
  assert.equal(clipName('w', 'Bär'), 'w_baer');
});

function fakeAudio({ fail = false } = {}) {
  const made = [];
  class FakeEl {
    constructor() { this.listeners = {}; this.played = []; made.push(this); }
    addEventListener(n, f) { this.listeners[n] = f; }
    removeEventListener(n) { delete this.listeners[n]; }
    pause() { this.paused = true; }
    play() {
      this.played.push(this.src);
      if (this.src.startsWith('data:')) return Promise.resolve();
      if (fail) return Promise.reject(new Error('NotAllowed'));
      queueMicrotask(() => this.listeners.ended?.());
      return Promise.resolve();
    }
  }
  const spoken = [];
  const speech = { speak: u => { spoken.push(u.text); queueMicrotask(() => u.onend?.()); }, cancel() { spoken.push('<cancel>'); }, getVoices: () => [{ lang: 'de-DE', name: 'Anna' }] };
  class FakeUtterance { constructor(t) { this.text = t; } }
  return { made, spoken, speech, FakeEl, FakeUtterance };
}

test('speak plays the clip on one shared element; a failing clip falls back to speech', async () => {
  const f = fakeAudio();
  const a = createAudio({ store: fresh(), AudioCtor: f.FakeEl, speech: f.speech, Utterance: f.FakeUtterance, log: quiet });
  a.unlock(); a.unlock();
  assert.equal(a.unlocked, true);
  assert.equal(f.made.length, 1);
  assert.equal(await a.speak({ clip: 'a_apfel', text: 'der Apfel' }), 'clip');
  assert.equal(f.made[0].played.at(-1), 'audio/a_apfel.mp3');
  assert.equal(f.made.length, 1);
  assert.equal(await a.speak({ text: 'Ein Satz.' }), 'speech');
  assert.ok(f.spoken.includes('Ein Satz.'));

  const g = fakeAudio({ fail: true });
  const b = createAudio({ AudioCtor: g.FakeEl, speech: g.speech, Utterance: g.FakeUtterance, log: quiet });
  assert.equal(await b.speak({ clip: 'a_apfel', text: 'der Apfel' }), 'speech');
  assert.ok(g.spoken.includes('der Apfel'));
  assert.equal(await b.speak({ clip: 'a_apfel' }), 'none');
});

test('sound off is a device setting and silences everything', async () => {
  const f = fakeAudio();
  const s = fresh();
  const a = createAudio({ store: s, AudioCtor: f.FakeEl, speech: f.speech, Utterance: f.FakeUtterance, log: quiet });
  assert.equal(a.enabled, true);
  a.setEnabled(false);
  assert.equal(a.enabled, false);
  assert.equal(s.get(K.appSettings()).sound, false);
  assert.equal(await a.speak({ clip: 'a_apfel', text: 'x' }), 'off');
  assert.equal(f.made.length, 0);
});
