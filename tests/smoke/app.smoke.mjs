// Smoke test in WebKit (Safari's engine): the staging app boots, a profile
// is created, sessions of every kind run to the results, the trainer, the
// game and the parents' screens open — with no page errors and the expected
// storage keys written. Run with `npm run smoke` (needs `npx playwright
// install webkit`).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { webkit } from 'playwright';
import { startServer } from '../../tools/serve.mjs';

let server, url, browser, page;
const errors = [];

before(async () => {
  ({ server, url } = await startServer({ port: 0 }));
  browser = await webkit.launch();
  const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, hasTouch: true });
  page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.route('**/*', r => { const u = new URL(r.request().url()); return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') ? r.continue() : r.abort(); });
});
after(async () => { await browser?.close(); server?.close(); });

const wait = ms => page.waitForTimeout(ms);
const kind = () => page.evaluate(() => document.querySelector('.fill-input') ? 'text' : document.querySelector('.order-pool') ? 'order' : document.querySelector('.pairs') ? 'pairs' : document.querySelector('.cycle') ? 'cycle' : document.querySelector('.answers-wrap .answers') ? 'multi' : 'tap');

/** Answer the current card once (wrong answers get their retry), then press Weiter. */
async function answerOne() {
  const k = await kind();
  const retry = async () => { const again = await page.$('.sheet .btn:not(.primary)'); if (again) { await again.click(); await wait(150); return true; } return false; };
  if (k === 'text') { await page.fill('.fill-input', 'x'); await page.click('.answers-wrap .btn.primary'); await wait(200); if (await retry()) { await page.fill('.fill-input', 'y'); await page.click('.answers-wrap .btn.primary'); } }
  else if (k === 'order') { for (const b of await page.$$('.order-pool .answer')) await b.click(); await page.click('.answers-wrap .btn.primary'); await wait(200); if (await retry()) { for (const b of await page.$$('.order-pool .answer')) await b.click(); await page.click('.answers-wrap .btn.primary'); } }
  else if (k === 'pairs') { const go = async () => { const L = await page.$$('.pairs .pairs-col:first-child .answer'), R = await page.$$('.pairs .pairs-col:last-child .answer'); for (let i = 0; i < L.length; i++) { await L[i].click(); await R[i].click(); } await page.click('.answers-wrap .btn.primary'); }; await go(); await wait(200); if (await retry()) await go(); }
  else if (k === 'multi') { const go = async () => { await (await page.$('.answers-wrap .answer:not(:disabled)')).click(); await page.click('.answers-wrap .btn.primary'); }; await go(); await wait(200); if (await retry()) await go(); }
  else { await (await page.$('.answers .answer:not(:disabled)')).click(); await wait(200); if (await retry()) await (await page.$('.answers .answer:not(:disabled)')).click(); }
  await wait(200);
  const next = await page.$('.sheet .btn.primary');
  if (next) await next.click();
  await wait(200);
}
async function playSession(max = 16) {
  for (let i = 0; i < max; i++) { if (!(await page.$('.counter'))) break; await answerOne(); }
  assert.equal(await page.evaluate(() => location.hash), '#/results', 'the session ends on the results screen');
}

test('boots, creates a profile, shows the home screen', async () => {
  await page.goto(url + 'next/index.html', { waitUntil: 'networkidle' });
  assert.ok(await page.$('.avatar.new'), 'welcome screen');
  await page.click('.avatar.new');
  await page.fill('#profile-name', 'Testkind');
  await page.selectOption('#profile-grade', '4');
  await page.click('.btn.primary');
  await wait(600);
  assert.equal(await page.evaluate(() => location.hash), '#/home');
  assert.ok(await page.$('.today .btn.primary'), 'the big button');
  assert.deepEqual(errors, []);
});

test('the daily training from the home screen runs to the results', async () => {
  await page.click('.today .btn.primary');
  await wait(600);
  assert.ok(await page.$('.counter'));
  await playSession();
  await page.click('.actions .btn.primary');
  await wait(400);
  assert.equal(await page.evaluate(() => location.hash), '#/home');
  assert.deepEqual(errors, []);
});

test('a water-cycle topic session covers the diagram, order and pairs types', async () => {
  await page.evaluate(() => { location.hash = '#/module/water'; });
  await wait(500);
  await page.locator('.topic').nth(3).click();   // Wasserkreislauf
  await wait(500);
  await playSession();
  assert.deepEqual(errors, []);
});

test('Deutsch mit Ella: training, a Lernpfad step, Zoo and Schatzkiste', async () => {
  await page.evaluate(() => { location.hash = '#/module/nouns'; });
  await wait(500);
  await page.click('.btn.primary');
  await wait(500);
  await playSession();
  await page.evaluate(() => { location.hash = '#/ella/lesson/nomen'; });
  await wait(500);
  assert.ok(await page.$('.lesson'), 'the lesson text');
  await page.click('.card .btn.primary');
  await wait(500);
  await playSession(10);
  for (const h of ['#/ella/zoo', '#/ella/progress']) { await page.evaluate(x => { location.hash = x; }, h); await wait(400); assert.ok(await page.$('.card'), h); }
  assert.deepEqual(errors, []);
});

test('Wort-Regen starts and ends', async () => {
  await page.evaluate(() => { location.hash = '#/game/wordrain'; });
  await wait(500);
  await page.click('.btn.primary');
  await wait(1200);
  assert.ok(await page.$('.wr-faller'), 'the falling article');
  await page.click('.wr-hud .icon-btn');
  await wait(400);
  assert.ok(await page.$('.actions'), 'the game-over screen');
  assert.deepEqual(errors, []);
});

test('the parents\' screens open; the expected keys exist in the namespace', async () => {
  await page.evaluate(() => { location.hash = '#/eltern'; });
  await wait(500);
  for (let i = 0; i < 5; i++) { await (await page.$$('.tabs button'))[i].click(); await wait(400); assert.ok(await page.$('.card'), `tab ${i}`); }
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('next_')));
  for (const k of ['next_family_profiles', 'next_app_profile', 'next_wq_srs_Testkind', 'next_wq_stats_Testkind', 'next_gram_srs_Testkind', 'next_plan_days_Testkind', 'next_wq_Testkind']) assert.ok(keys.includes(k), k);
  assert.ok(!keys.some(k => /family_sync_id/.test(k)), 'no family code');
  assert.ok(!Object.keys(await page.evaluate(() => ({ ...localStorage }))).some(k => !k.startsWith('next_')), 'nothing outside the namespace');
  assert.deepEqual(errors, []);
});
