import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderTable, START, END } from '../tools/keys-table.mjs';

const doc = readFileSync(new URL('../docs/MIGRATION.md', import.meta.url), 'utf8');

test('docs/MIGRATION.md contains the key table exactly as the registry renders it', () => {
  const a = doc.indexOf(START), b = doc.indexOf(END);
  assert.ok(a !== -1 && b !== -1 && b > a, 'markers missing');
  const inDoc = doc.slice(a + START.length, b).trim();
  assert.equal(inDoc, renderTable().trim(), 'run: node tools/keys-table.mjs and paste the table between the markers');
});
