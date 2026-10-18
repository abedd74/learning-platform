import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateAll } from '../tools/validate-content.mjs';

function fixture(files) {
  const dir = mkdtempSync(join(tmpdir(), 'lp-content-'));
  for (const [path, value] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return dir;
}

const mod = (extra = {}) => ({ id: 'whales', name: { de: 'Wale' }, engine: 'quiz', idPrefix: 'wal_',
  topics: [{ id: 'arten', file: 'arten.json' }], ...extra });

test('missing content folder is fine', () => {
  const r = validateAll(join(tmpdir(), 'lp-does-not-exist'));
  assert.deepEqual(r.errors, []);
  assert.equal(r.modules, 0);
});

test('a valid module passes', () => {
  const dir = fixture({ 'whales/module.json': mod(), 'whales/arten.json': [{ id: 'wal_arten-h1' }, { id: 'wal_arten-h2' }] });
  const r = validateAll(dir);
  assert.deepEqual(r.errors, []);
  assert.equal(r.items, 2);
});

test('duplicate ids, wrong prefix, missing file and bad JSON are errors', () => {
  const dir = fixture({
    'whales/module.json': mod({ topics: [{ id: 'arten', file: 'arten.json' }, { id: 'x', file: 'missing.json' }, { id: 'y', file: 'bad.json' }] }),
    'whales/arten.json': [{ id: 'wal_a' }, { id: 'wal_a' }, { id: 'book_b' }, {}],
    'whales/bad.json': '{ nope',
  });
  const msgs = validateAll(dir).errors.join('\n');
  assert.match(msgs, /duplicate id "wal_a"/);
  assert.match(msgs, /lacks module prefix "wal_"/);
  assert.match(msgs, /missing id/);
  assert.match(msgs, /missing\.json not found/);
  assert.match(msgs, /bad\.json: invalid JSON/);
});

test('module id must match its folder', () => {
  const dir = fixture({ 'wale/module.json': mod(), 'wale/arten.json': [] });
  assert.match(validateAll(dir).errors.join('\n'), /differs from folder "wale"/);
});
