// 90-day simulation of the scheduler with a model learner (DESIGN §4.2).
//
// The learner forgets with a probability that rises with the gap since the
// last review and falls as a card's memory strengthens; after a mistake the
// explanation resets the memory to a base that grows a little each time.
// Every day the "planner" reviews the due cards (weakest first, within a
// daily budget) and introduces a few new cards. The test checks that the
// scheduler is stable: the backlog stays bounded, due cards are reviewed
// promptly, most cards end up mastered, and chronically hard cards (leeches)
// come back quickly. Deterministic: a seeded random source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config, QUIZ_INTERVALS, NOUN_INTERVALS, review, isDue, isLeech, intervalOf, summarize } from '../app/core/srs.js';
import { addDays, diffDays } from '../app/core/time.js';

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function simulate({ cards = 120, days = 90, cfg, budget = 50, newPerDay = 8, throttleDue = 20, seed = 7, hard = 0.1, start = '2026-10-18' }) {
  const rng = mulberry32(seed);
  // Memory strength in days: recall after a gap g is exp(-g/strength).
  // An ordinary card starts at 3 days and grows ×2.5 per success (a box-1
  // card is recalled ~75 %, a box-5 card ~90 %). A "hard" card starts at
  // 0.8 days and grows ×1.8 — those become the leeches.
  const isHard = Array.from({ length: cards }, () => rng() < hard);
  const base = isHard.map(h => (h ? 0.8 : 3));
  const grow = i => (isHard[i] ? 1.8 : 2.5);
  const strength = base.slice();
  const fails = Array(cards).fill(0);
  const lastSeen = Array(cards).fill(null);
  const store = {};
  let introduced = 0, day = start;
  const stats = { maxLate: 0, backlog: [], dueAtStart: [], reviews: 0, rights: 0, leechIntervals: [] };

  const answer = (i, right, id) => {
    store[id] = review(store[id], right ? 'first' : 'wrong', day, cfg, rng);
    if (right) strength[i] *= grow(i);
    else { fails[i]++; strength[i] = base[i] * (1 + 0.2 * fails[i]); }   // the explanation teaches a little
    lastSeen[i] = day;
    if (isLeech(store[id], cfg)) stats.leechIntervals.push(intervalOf(store[id], cfg));
  };

  for (let d = 0; d < days; d++) {
    let answers = 0;
    const due = Object.keys(store).filter(id => isDue(store[id], day))
      .sort((a, b) => (store[a].b - store[b].b) || (store[a].due < store[b].due ? -1 : 1));
    stats.dueAtStart.push(due.length);
    for (const id of due) {
      if (answers >= budget) break;
      const i = Number(id);
      stats.maxLate = Math.max(stats.maxLate, diffDays(store[id].due, day));
      const gap = Math.max(1, diffDays(lastSeen[i], day));
      const right = rng() < Math.exp(-gap / strength[i]);
      answer(i, right, id);
      answers++; stats.reviews++; if (right) stats.rights++;
    }
    const dueLeft = Object.keys(store).filter(id => isDue(store[id], day)).length;
    if (dueLeft <= throttleDue) {
      for (let n = 0; n < newPerDay && introduced < cards && answers < budget; n++) {
        const i = introduced++;
        answer(i, rng() < 0.75, String(i));                      // first encounter
        answers++;
      }
    }
    stats.backlog.push(Object.keys(store).filter(id => isDue(store[id], day) && diffDays(store[id].due, day) > 0).length);
    day = addDays(day, 1);
  }
  return { store, stats, introduced, day };
}

for (const [name, intervals] of [['quiz', QUIZ_INTERVALS], ['nouns', NOUN_INTERVALS]]) {
  const cfg = config({ intervals, fuzz: name === 'nouns' ? 1 : 0 });

  test(`${name}: 90 days with 120 cards stay within budget and the backlog stays bounded`, () => {
    const { store, stats, introduced, day } = simulate({ cfg });
    assert.equal(introduced, 120);
    const lastMonth = stats.backlog.slice(60);
    const avgBacklog = lastMonth.reduce((a, b) => a + b, 0) / lastMonth.length;
    assert.ok(avgBacklog < 5, `average overdue backlog in days 60–90 is ${avgBacklog.toFixed(1)}`);
    assert.ok(stats.maxLate <= 3, `a due card waited ${stats.maxLate} days`);
    const s = summarize(store, day, cfg);
    assert.ok(s.mastered / s.total >= 0.6, `mastered share ${(s.mastered / s.total).toFixed(2)}`);
    const recall = stats.rights / stats.reviews;
    assert.ok(recall > 0.7 && recall < 0.98, `review recall ${recall.toFixed(2)} looks unrealistic`);
    const avgDue = stats.dueAtStart.slice(30).reduce((a, b) => a + b, 0) / 60;
    assert.ok(avgDue < 30, `average due per day after day 30 is ${avgDue.toFixed(1)}`);
    if (process.env.LP_SIM_LOG) {
      console.log(`${name}: recall ${(recall * 100).toFixed(0)} %, mastered ${s.mastered}/${s.total}, leeches ${s.leeches}, ` +
        `avg due/day after day 30: ${avgDue.toFixed(1)}, max lateness ${stats.maxLate} d, boxes ${JSON.stringify(s.byBox)}`);
    }
  });

  test(`${name}: leeches are always scheduled within the damped interval`, () => {
    const { stats } = simulate({ cfg, hard: 0.3, seed: 11 });
    assert.ok(stats.leechIntervals.length > 0, 'no leech ever happened');
    const longest = Math.max(...stats.leechIntervals);
    assert.ok(longest <= Math.round(intervals[intervals.length - 1] * 0.6), `a leech was scheduled ${longest} days out`);
  });

  test(`${name}: the simulation is deterministic for a seed`, () => {
    const a = simulate({ cfg, seed: 3 });
    const b = simulate({ cfg, seed: 3 });
    assert.deepEqual(a.store, b.store);
    assert.deepEqual(a.stats, b.stats);
  });
}

test('a learner who forgets everything is held in the lowest boxes, not pushed up', () => {
  const cfg = config({ intervals: QUIZ_INTERVALS });
  let rec, day = '2026-10-18';
  for (let i = 0; i < 30; i++) { rec = review(rec, 'wrong', day, cfg); day = addDays(day, 1); }
  assert.equal(rec.b, 0);
  assert.ok(isLeech(rec, cfg));
  assert.equal(rec.due, addDays(day, -1));   // box 0 = 0 days: due the day it was answered
});

test('a perfect learner reaches the top box and is seen ever more rarely', () => {
  const cfg = config({ intervals: NOUN_INTERVALS });
  let rec, day = '2026-10-18', reviews = 0;
  const end = addDays(day, 365);
  while (day < end) {
    if (!rec || isDue(rec, day)) { rec = review(rec, 'first', day, cfg); reviews++; }
    day = addDays(day, 1);
  }
  assert.equal(rec.b, 8);
  assert.ok(reviews <= 12, `${reviews} reviews in a year for a perfect card`);
});
