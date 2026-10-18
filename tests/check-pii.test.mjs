import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanText, mask, LEGACY_EXEMPT } from '../tools/check-pii.mjs';

const rules = text => scanText(text, { file: 'x.js' }).map(h => h.rule);
// Test inputs are glued from pieces so this file itself scans clean.
const j = (...parts) => parts.join('');

test('family link with a real-looking value is caught, placeholders are not', () => {
  assert.deepEqual(rules(j('open …/index.html?familie', '=a1b2c3d4e5f6')), ['family-code-in-link']);
  assert.deepEqual(rules('(…/index.html?familie=GEHEIMER-CODE)'), []);
  assert.deepEqual(rules('the ?familie= parameter'), []);
  assert.deepEqual(rules(j("localStorage.setItem('family_sync_id'", ", 'abc123def456abc123def456')")), ['family-code-literal']);
  assert.deepEqual(rules(j('documents/families', '/0f3a9c77e21b0f3a9c77e21b/stores')), ['family-code-path']);
  // short values are names of things, not codes
  assert.deepEqual(rules("{ family_sync_id: 'familyId' }"), []);
  assert.deepEqual(rules('families/{code}/stores'), []);
  assert.deepEqual(rules('documents/families/${encodeURIComponent(familyId())}/stores'), []);
});

test('e-mail addresses are caught except the allowed no-reply ones', () => {
  assert.deepEqual(rules(j('write to someone.name', '@mail.de')), ['email']);
  assert.deepEqual(rules('Co-Authored-By: Claude <noreply@anthropic.com>'), []);
  assert.deepEqual(rules('1234+user@users.noreply.github.com'), []);
});

test('phone numbers with country code or German mobile prefix are caught', () => {
  assert.deepEqual(rules(j('call +4', '9 170 1234567')), ['phone']);
  assert.deepEqual(rules(j('017', '1 1234567')), ['phone']);
  assert.deepEqual(rules('<path d="M 10 20 30 40 50 60 70 80"/>'), []);
  assert.deepEqual(rules('due 2026-10-18, box 4, 1234567 points'), []);
});

test('home folders, machine names and keys are caught', () => {
  assert.deepEqual(rules(j('/Use', 'rs/someone/Documents/x')), ['home-folder-path']);
  assert.deepEqual(rules(j('user', '@Mac', 'Book-Pro-2.local')), ['email', 'machine-name']);
  const key = 'AIza' + 'B'.repeat(35);
  assert.deepEqual(rules(`apiKey: '${key}'`), ['google-api-key']);
  assert.deepEqual(scanText(`apiKey: '${key}'`, { file: 'sync.js' }), []);
  assert.deepEqual(rules('token ghp_' + 'a'.repeat(36)), ['github-token']);
});

test('private words match at word start, case-insensitively, incl. genitive', () => {
  const words = ['Ottilie'];
  const hit = t => scanText(t, { file: 'a.json', words }).map(h => h.rule);
  assert.deepEqual(hit('Stimmt das, was Ottilie sagt?'), ['private-word-1']);
  assert.deepEqual(hit('OTTILIES Heft'), ['private-word-1']);
  assert.deepEqual(hit('Bottilie'), []);
  assert.deepEqual(scanText('Ottilie', { file: [...LEGACY_EXEMPT][0], words }), []);
});

test('hits are masked so the scan never repeats a name or a secret', () => {
  assert.equal(mask('Ottilie'), 'O******');
  assert.equal(mask('ab'), '**');
  const [h] = scanText('x Ottilie', { file: 'a.md', words: ['Ottilie'] });
  assert.equal(h.masked, 'O******');
  assert.equal(h.line, 1);
  assert.equal(h.col, 3);
});
