import { test } from 'node:test';
import assert from 'node:assert/strict';
import { today, isDay, addDays, diffDays, compareDays, parseLegacyDate, toLegacyDate, weekday } from '../app/core/time.js';

test('today() is the Berlin calendar day, not the UTC one', () => {
  // 23:30 UTC on 18 Oct = 01:30 on 19 Oct in Berlin (CEST)
  assert.equal(today(new Date('2026-10-18T23:30:00Z')), '2026-10-19');
  // 23:30 UTC on 15 Dec = 00:30 on 16 Dec in Berlin (CET)
  assert.equal(today(new Date('2026-12-15T23:30:00Z')), '2026-12-16');
  assert.equal(today(new Date('2026-12-15T22:30:00Z')), '2026-12-15');
  assert.equal(today(Date.UTC(2026, 5, 1, 12)), '2026-06-01');
});

test('isDay accepts only real calendar days', () => {
  assert.ok(isDay('2026-02-28'));
  assert.ok(!isDay('2026-02-30'));
  assert.ok(!isDay('2026-2-3'));
  assert.ok(!isDay('5.3.2026'));
  assert.ok(!isDay(null));
});

test('addDays and diffDays cross months, years and DST changes', () => {
  assert.equal(addDays('2026-10-18', 14), '2026-11-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(diffDays('2026-10-18', '2026-11-01'), 14);
  assert.equal(diffDays('2026-11-01', '2026-10-18'), -14);
  // DST ends 2026-10-25 in Europe: still whole days
  assert.equal(diffDays('2026-10-24', '2026-10-26'), 2);
  assert.throws(() => addDays('nope', 1), TypeError);
});

test('compareDays orders day strings', () => {
  assert.equal(compareDays('2026-01-02', '2026-01-10'), -1);
  assert.equal(compareDays('2026-01-10', '2026-01-10'), 0);
  assert.equal(compareDays('2027-01-01', '2026-12-31'), 1);
});

test('legacy round-history dates parse in both paddings and round-trip', () => {
  assert.equal(parseLegacyDate('5.3.2026'), '2026-03-05');
  assert.equal(parseLegacyDate('05.03.2026'), '2026-03-05');
  assert.equal(parseLegacyDate('2026-03-05'), '2026-03-05');
  assert.equal(parseLegacyDate('31.02.2026'), null);
  assert.equal(parseLegacyDate(''), null);
  assert.equal(parseLegacyDate(undefined), null);
  assert.equal(toLegacyDate('2026-03-05'), '5.3.2026');
});

test('weekday: Monday is 0', () => {
  assert.equal(weekday('2026-10-19'), 0);   // a Monday
  assert.equal(weekday('2026-10-18'), 6);   // a Sunday
});
