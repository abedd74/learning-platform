// A module: practise everything, or one topic.
import { el, mount } from '../dom.js';
import { horizon } from '../horizon.js';
import { keys as K } from '../../core/storage.js';
import { summarize, config as srsConfig } from '../../core/srs.js';
import { today as todayOf } from '../../core/time.js';

export async function renderModule(root, ctx, { id }) {
  const { i18n, store, profile } = ctx;
  const m = ctx.modules.find(x => x.id === id);
  if (!m) { ctx.go('home'); return; }
  if (m.engine !== 'quiz') { await m.renderHome?.(root, ctx); return; }
  const today = todayOf();
  const cards = await ctx.cardsOf(m);
  const srs = store.get(K.quizSrs(profile.key), {}) || {};
  const cfg = srsConfig(m.srs || {});

  const col = el('div', { class: 'col enter' });
  col.appendChild(el('div', { class: 'topbar' }, el('button', { class: 'icon-btn', type: 'button', 'aria-label': i18n.t('module.back'), onClick: () => ctx.go('home') }, '←'),
    el('div', { class: 'greet' }, el('span', { class: 'disc' }, m.icon), el('div', {}, el('h1', {}, m.name.de), m.name.it ? el('div', { class: 'it' }, m.name.it) : null))));
  const all = summarize(Object.fromEntries(cards.map(c => [c.id, srs[c.id]]).filter(([, r]) => r)), today, cfg);
  col.appendChild(el('section', { class: 'card stack' },
    el('div', { class: 'row spread' }, el('span', { class: 'eyebrow' }, i18n.t('module.all')), el('span', { class: 'chip' }, i18n.t('module.mastered', { n: all.mastered, total: cards.length }))),
    el('button', { class: 'btn primary', type: 'button', style: { width: '100%' }, onClick: () => ctx.startSession({ cards, module: m.id, mode: 'mixed' }) }, `${i18n.t('module.all')}${all.due ? ` · ${i18n.t('module.due', { n: all.due })}` : ''}`)));

  const list = el('div', { class: 'topics' });
  for (const t of m.topics) {
    const tc = cards.filter(c => c.topic === t.id);
    const s = summarize(Object.fromEntries(tc.map(c => [c.id, srs[c.id]]).filter(([, r]) => r)), today, cfg);
    list.appendChild(el('button', { class: 'topic', type: 'button', onClick: () => ctx.startSession({ cards: tc, module: m.id, mode: t.id }) },
      el('span', { class: 'icon' }, t.icon || '•'),
      el('span', {}, el('div', { class: 't' }, t.label.de), el('div', { class: 's' }, [`${s.mastered}/${tc.length}`, s.due ? i18n.t('module.due', { n: s.due }) : null, i18n.showItalian && t.label.it ? t.label.it : null].filter(Boolean).join(' · '))),
      el('span', { class: 'go' }, `${i18n.t('module.topic.go')} ›`)));
  }
  col.appendChild(list);
  mount(root, el('div', { class: 'stage' }, horizon(), col));
}
