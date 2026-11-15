// version.json must describe what is in app/ and content/ right now: the
// devices decide by it whether to re-fetch the app's files (boot.js). After
// any change to app/ or content/ run:  npm run stamp
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, readStamp } from '../tools/stamp-version.mjs';
import { versionFrom, FALLBACK_VERSION, filesFrom } from '../app/core/version.js';

test('version.json is stamped from the current app/ and content/ (run: npm run stamp)', () => {
  const stamp = readStamp();
  const now = fingerprint();
  assert.ok(stamp, 'version.json is missing or not JSON');
  assert.equal(stamp.hash, now.hash, 'app/ or content/ changed since the last stamp — run: npm run stamp');
  assert.deepEqual(stamp.files, now.files, 'the list of app files changed — run: npm run stamp');
  assert.notEqual(versionFrom(stamp), FALLBACK_VERSION);
  assert.ok(stamp.version.endsWith(stamp.hash.slice(0, 7)));
});

test('the file list is taken only as plain relative app paths', () => {
  assert.deepEqual(filesFrom({ files: ['main.js', 'core/srs.js', 'ui/app.css'] }), ['main.js', 'core/srs.js', 'ui/app.css']);
  assert.deepEqual(filesFrom({ files: ['../secret.js', 'https://x.example/a.js', '/abs.js', 'a b.js', 7, 'ok.js'] }), ['ok.js']);
  assert.deepEqual(filesFrom(null), []);
  assert.deepEqual(filesFrom({ files: 'main.js' }), []);
});
