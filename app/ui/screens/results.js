// Results: the ring, a kind headline, three facts, Nochmal / Fertig.
import { el, mount, append, nextFrame } from '../dom.js';
import { horizon } from '../horizon.js';
import { streak } from '../../core/planner.js';
import { today as todayOf } from '../../core/time.js';
import { practisedDays } from './home.js';

export function renderResults(root, ctx, summary, { onAgain, onDone, extras = null }) {
  const { i18n, profile, store } = ctx;
  const pct = Math.round(summary.pct * 100);
  const mod = summary.modules.length === 1 ? ctx.modules.find(m => m.id === summary.modules[0]) : null;
  const mascot = mod?.mascot?.name || 'Ella';
  const headline = pct >= 80 ? 'results.great' : pct >= 50 ? 'results.good' : 'results.keep';
  const n = streak(practisedDays(store, profile.key), todayOf());

  const col = el('div', { class: 'col results enter' });
  const score = el('div', { class: 'score', style: { '--p': '0' } }, el('div', { class: 'inner' }, el('span', { class: 'n' }, String(summary.firstTry + summary.retried)), el('span', { class: 'of' }, i18n.t('results.of', { total: summary.total }))));
  append(col, [
    el('span', { class: 'eyebrow' }, mod ? mod.name.de : i18n.t('home.today')),
    score,
    el('h1', {}, extras?.title?.de || i18n.t(headline, { name: profile.name })),
    extras?.title?.it ? el('div', { class: 'it' }, extras.title.it) : null,
    el('div', { class: 'soft', style: { fontSize: '18px' } }, `${mod?.icon || '🦉'} ${i18n.t('results.proud', { mascot })}`),
    el('div', { class: 'facts' },
      fact(summary.newCount, i18n.t('results.new')), fact(summary.total - summary.newCount, i18n.t('results.reviewed')), fact(n, i18n.t('results.streak'))),
    extras?.notes?.length ? el('div', { class: 'card stack', style: { width: '100%', textAlign: 'left' } }, ...extras.notes.map(n => el('div', { class: n.kind === 'badge' ? 'hint-text' : n.kind === 'unlock' ? 'hint-text' : 'soft', style: { fontWeight: '800' } }, `${n.kind === 'badge' ? '🏅 ' : n.kind === 'unlock' ? '🔓 ' : ''}${n.text.de}`, n.text.it ? el('span', { class: 'it' }, n.text.it) : null))) : null,
    el('div', { class: 'actions' }, el('button', { class: 'btn', type: 'button', onClick: extras?.again?.run || onAgain }, extras?.again?.label || i18n.t('results.again')), el('button', { class: 'btn primary', type: 'button', onClick: onDone }, i18n.t('results.done'))),
  ]);
  mount(root, el('div', { class: 'stage' }, horizon(), col));
  nextFrame(() => { score.style.setProperty('--p', String(pct)); });
}

const fact = (v, l) => el('div', { class: 'fact' }, el('span', { class: 'v' }, String(v)), el('span', { class: 'l' }, l));
