// Home: greeting, the "Heute" card with one big button, the streak, the
// module tiles, games, last year's modules folded, a tiny footer.
import { el, mount } from '../dom.js';
import { horizon } from '../horizon.js';
import { keys as K } from '../../core/storage.js';
import { planSession, streak, goalReached, testPrepModules } from '../../core/planner.js';
import { summarize, config as srsConfig } from '../../core/srs.js';
import { today as todayOf, weekday, addDays } from '../../core/time.js';
import { footerText } from '../../core/version.js';

const GAMES = [{ id: 'wordrain', icon: '🌧️', name: { de: 'Wort-Regen', it: 'Pioggia di parole' } }];

/** Days practised: the new cross-module record plus the old trainer's, so the streak carries over. */
export function practisedDays(store, profile) {
  const out = {};
  for (const [d, v] of Object.entries(store.get(K.gramDays(profile), {}) || {})) if ((v?.a || 0) > 0) out[d] = { a: v.a };
  for (const [d, v] of Object.entries(store.get(K.planDays(profile), {}) || {})) if ((v?.a || 0) > 0) out[d] = { a: (out[d]?.a || 0) + v.a };
  return out;
}

export async function renderHome(root, ctx) {
  const { i18n, store, profile } = ctx;
  const today = todayOf();
  const cards = await ctx.allCards();                    // every active module's cards with records
  const dayRec = store.get(K.planDays(profile.key), {})?.[today] || null;
  const plan = store.get(K.plan(profile.key), null);
  const planned = planSession({ cards, today, dayRecord: dayRec, plan, cfg: ctx.plannerCfg });
  const dueTotal = planned.counts.dueTotal;
  const newInSession = planned.counts.new;
  const days = practisedDays(store, profile.key);
  const n = streak(days, today);
  const reached = goalReached(dayRec, ctx.plannerCfg);
  const prep = testPrepModules(plan, today, ctx.plannerCfg);

  const col = el('div', { class: 'col enter' });
  col.appendChild(el('div', { class: 'greet' }, el('span', { class: 'disc' }, profile.avatar),
    el('div', {}, el('h1', {}, i18n.t('home.hello', { name: profile.name })), el('div', { class: 'soft' }, i18n.t('home.sub')))));

  // the Heute card
  const todayCard = el('section', { class: 'card today' });
  todayCard.appendChild(el('div', { class: 'row spread' }, el('span', { class: 'eyebrow' }, i18n.t('home.today')),
    el('span', { class: 'streak' }, n ? `🔥 ${i18n.t('home.streak', { n })}` : `✨ ${i18n.t('home.streak.none')}`)));
  const big = dueTotal || newInSession;
  const what = dueTotal === 0 ? (newInSession ? i18n.t('home.waiting.new', { n: newInSession }) : i18n.t('home.waiting.none')) : dueTotal === 1 ? i18n.t('home.waiting.one') : i18n.t('home.waiting', { n: dueTotal });
  const modulesLine = planned.cards.length ? [...new Set(planned.cards.map(c => ctx.moduleName(c.module)))].join(' · ') : '';
  todayCard.appendChild(el('div', { class: 'plan' }, el('span', { class: 'big' }, big ? String(big) : '✨'),
    el('div', {}, el('div', { class: 'what' }, what), el('div', { class: 'soft' }, [dueTotal && newInSession ? i18n.t('home.new', { n: newInSession }) : null, modulesLine].filter(Boolean).join(' · ')))));
  // week strip: Monday … Sunday of this week
  const monday = addDays(today, -weekday(today));
  const week = el('div', { class: 'week' });
  ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].forEach((lab, i) => {
    const d = addDays(monday, i);
    const on = !!days[d];
    week.appendChild(el('div', { class: 'd' }, el('span', { class: `dot${on ? ' on' : ''}${d === today ? ' today' : ''}` }, on ? '✓' : ''), lab));
  });
  todayCard.appendChild(week);
  todayCard.appendChild(el('button', { class: 'btn primary', type: 'button', style: { width: '100%' }, disabled: planned.cards.length === 0,
    onClick: () => ctx.startSession({ cards, module: 'mixed', mode: 'mixed' }) }, reached ? i18n.t('home.goal.done') : i18n.t('home.go')));
  col.appendChild(todayCard);

  // module tiles
  const head = el('div', { class: 'row spread' }, el('h2', {}, i18n.t('home.topics')));
  const prepEntries = Object.entries(prep);
  if (prepEntries.length) head.appendChild(el('span', { class: 'chip' }, i18n.t('home.test', { date: fmtDate(plan.tests[prepEntries[0][0]]), module: ctx.moduleName(prepEntries[0][0]) })));
  col.appendChild(head);
  const tiles = el('div', { class: 'tiles' });
  for (const m of ctx.modules.filter(m => !m.archive)) {
    const sum = m.engine === 'quiz' ? summarize(store.get(K.quizSrs(profile.key), {}), today, srsConfig(m.srs || {})) : m.summary?.(ctx) || { total: 0, mastered: 0, due: 0 };
    const total = m.engine === 'quiz' ? m.count : sum.total;
    const p = total ? Math.round(100 * sum.mastered / total) : 0;
    const sub = sum.due ? i18n.t('module.due', { n: sum.due }) : i18n.t('module.mastered', { n: sum.mastered, total });
    tiles.appendChild(el('button', { class: 'tile', type: 'button', onClick: () => ctx.go('module', { id: m.id }) },
      el('span', { class: 'mascot', style: { background: m.tint || 'var(--card-tint)' } }, m.icon), el('span', { class: 't' }, m.name.de),
      el('span', { class: 'foot' }, el('span', { class: 's' }, sub), el('span', { class: 'ring', style: { '--p': String(p) } }))));
  }
  col.appendChild(tiles);

  // games
  col.appendChild(el('div', { class: 'row spread' }, el('h2', {}, i18n.t('home.games'))));
  const games = el('div', { class: 'tiles' });
  for (const g of GAMES) {
    const high = store.get(K.wrHigh(profile.key), 0) || 0;
    games.appendChild(el('button', { class: 'tile', type: 'button', onClick: () => ctx.go('game', { id: g.id }) },
      el('span', { class: 'mascot', style: { background: 'var(--m-wordrain)' } }, g.icon), el('span', { class: 't' }, g.name.de),
      el('span', { class: 'foot' }, el('span', { class: 's' }, high ? `Rekord ${high}` : ''))));
  }
  col.appendChild(games);

  // archive
  const archive = ctx.modules.filter(m => m.archive);
  if (archive.length) {
    const row = el('div', { class: 'folded' }, el('span', { class: 'muted', style: { fontWeight: '800' } }, `${i18n.t('home.archive')}:`));
    for (const m of archive) row.appendChild(el('button', { class: 'mini', type: 'button', onClick: () => ctx.go('module', { id: m.id }) }, `${m.icon} ${m.name.de}`));
    col.appendChild(row);
  }

  col.appendChild(el('div', { class: 'foot-note' },
    el('span', {}, footerText(ctx.version, ctx.sync.status)),
    el('span', {}, el('button', { type: 'button', onClick: () => ctx.go('welcome') }, i18n.t('home.switch')), ' · ', el('button', { type: 'button', onClick: () => ctx.go('eltern') }, i18n.t('footer.parents')))));
  mount(root, el('div', { class: 'stage' }, horizon(), col));
}

function fmtDate(day) {
  const [y, m, d] = String(day).split('-');
  return `${Number(d)}.${Number(m)}.`;
}
