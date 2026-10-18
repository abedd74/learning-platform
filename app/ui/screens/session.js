// The session screen: one card at a time, the answer area, feedback sheet,
// one retry with the hint, then the explanation and "Weiter".
import { el, mount, clear, bilingual } from '../dom.js';
import { horizon } from '../horizon.js';
import { renderAnswer, instructionKey } from '../../engines/quiz/render.js';

export function renderSessionScreen(root, ctx, session, { onDone, onQuit }) {
  const { i18n, audio } = ctx;
  const col = el('div', { class: 'col' });
  const segments = el('div', { class: 'segments' });
  const counter = el('span', { class: 'counter' });
  const closeBtn = el('button', { class: 'icon-btn', type: 'button', 'aria-label': i18n.t('session.close'), onClick: askQuit }, '✕');
  const bubble = el('div', { class: 'bubble' });
  const mascot = el('span', { class: 'm' });
  const body = el('div', { class: 'stack', id: 'session-body' });
  col.append(el('div', { class: 'topbar' }, closeBtn, segments, counter), el('div', { class: 'speech' }, mascot, bubble), body);
  mount(root, el('div', { class: 'stage' }, horizon(), col));

  const outcomes = [];   // per queue position: 'ok' | 'miss' | undefined
  let answerUi = null;

  function paintProgress() {
    const cur = session.current();
    const total = session.size;
    clear(segments);
    for (let i = 0; i < total; i++) segments.appendChild(el('i', { class: outcomes[i] === 'ok' ? 'done' : outcomes[i] === 'miss' ? 'miss' : (cur && i === cur.index ? 'now' : '') }));
    counter.textContent = cur ? `${cur.index + 1} / ${total}` : `${total} / ${total}`;
  }

  function show() {
    const cur = session.current();
    if (!cur) { onDone(session.finish()); return; }
    const { item } = cur;
    const q = item.question;
    const mod = ctx.modules.find(m => m.id === item.card.module);
    mascot.textContent = mod?.icon || '🦉';
    const topicLabel = mod?.topics?.find(t => t.id === item.card.topic)?.label?.de || mod?.name?.de || '';
    bubble.textContent = `${topicLabel ? topicLabel + ' · ' : ''}${cur.rehearsal ? i18n.t('session.again') : i18n.t('session.think')}`;
    paintProgress();
    clear(body);
    body.appendChild(questionCard(q, ctx, mod));
    answerUi = renderAnswer(q, { i18n, rng: Math.random, cycleSteps: mod?.cycleSteps, onAnswer: response => handle(response, q) });
    body.appendChild(el('div', { class: 'enter' }, answerUi.node));
    if (q.type === 'gender' && q.noun) audio.speak({ clip: `w_${audio.slug(q.noun.de)}`, text: q.noun.de });
    col.scrollTop = 0;
  }

  function handle(response, q) {
    const r = session.answer(response);
    const cur = session.current();
    if (!r.final) {
      // one retry with the hint
      const sheet = el('section', { class: 'sheet warn' }, el('div', { class: 'head' }, `💡 ${i18n.t('session.almost')}`));
      if (q.hint?.de) sheet.appendChild(bilingual(i18n.pick(q.hint), { cls: 'hint-text' }));
      sheet.appendChild(el('button', { class: 'btn', type: 'button', onClick: () => { sheet.remove(); answerUi.reset(); } }, i18n.t('session.again')));
      body.appendChild(sheet);
      sheet.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    answerUi.reveal({ ok: r.ok, response, expected: r.expected });
    if (cur) outcomes[cur.index] = r.ok && r.outcome === 'first' ? 'ok' : (r.ok ? 'ok' : 'miss');
    paintProgress();
    const sheet = el('section', { class: `sheet${r.ok ? '' : ' warn'}` });
    sheet.appendChild(el('div', { class: 'head' }, r.ok ? `✓ ${i18n.t(r.outcome === 'first' ? 'session.right' : 'session.right.retry')}` : i18n.t('session.wrong')));
    if (q.explain?.de) sheet.appendChild(bilingual(i18n.pick(q.explain)));
    if (q.type === 'gender' && q.noun) {
      sheet.appendChild(el('div', { class: 'hint-text' }, `${q.noun.g} ${q.noun.de}${q.noun.pl ? ` · die ${q.noun.pl}` : ''}${q.noun.it && i18n.showItalian ? ` · ${q.noun.it}` : ''}`));
      audio.speak({ clip: `a_${audio.slug(q.noun.de)}`, text: `${q.noun.g} ${q.noun.de}` });
    }
    const next = el('button', { class: 'btn primary', type: 'button', onClick: () => { session.next(); show(); } }, i18n.t('session.next'));
    sheet.appendChild(next);
    body.appendChild(sheet);
    sheet.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => next.focus({ preventScroll: true }), 50);
  }

  function askQuit() {
    if (body.querySelector('.quit')) return;
    const sheet = el('section', { class: 'sheet plain quit' }, el('div', { class: 'head' }, i18n.t('session.quit.ask')),
      el('div', { class: 'row end' }, el('button', { class: 'btn ghost', type: 'button', onClick: () => sheet.remove() }, i18n.t('session.quit.no')),
        el('button', { class: 'btn', type: 'button', onClick: () => onQuit(session.finish()) }, i18n.t('session.quit.yes'))));
    body.appendChild(sheet);
  }

  show();
}

/** The question card: instruction, prompt (and figure, statement, word). */
function questionCard(q, ctx, mod) {
  const { i18n } = ctx;
  const card = el('section', { class: 'card question enter' });
  card.appendChild(el('span', { class: 'eyebrow' }, i18n.t(instructionKey(q.type))));
  if (q.type === 'gender') {
    if (q.noun.em) card.appendChild(el('div', { class: 'em' }, q.noun.em));
    card.appendChild(el('div', { class: 'word' }, q.noun.de));
    if (q.noun.it && i18n.showItalian) card.appendChild(el('div', { class: 'it' }, q.noun.it));
    return card;
  }
  if (q.type === 'case' || q.type === 'pfill' || q.type === 'pmcq') {
    if (q.em) card.appendChild(el('div', { class: 'em' }, q.em));
    card.appendChild(el('div', { class: 'q' }, q.sentence || q.sent || q.t || ''));
    if (q.task) card.appendChild(el('div', { class: 'soft' }, q.task));
    if (q.task_it && i18n.showItalian) card.appendChild(el('div', { class: 'it' }, q.task_it));
    if (q.base) card.appendChild(el('div', { class: 'chip' }, q.base));
    return card;
  }
  if (q.media?.figure) {
    const fig = el('figure', {});
    fetch(new URL(q.media.figure, ctx.assetsBase).href).then(r => r.text()).then(svg => { const t = document.createElement('template'); t.innerHTML = svg; const s = t.content.querySelector('svg'); if (s) fig.appendChild(s); }).catch(() => {});
    card.appendChild(fig);
  }
  if (q.type === 'bool') {
    card.appendChild(el('div', { class: 'soft' }, i18n.t('session.says', { name: mod?.mascot?.name || '' })));
    card.appendChild(bilingual(i18n.pick(q.answer.statement), { cls: 'statement' }));
    return card;
  }
  // a text question whose prompt only repeats the instruction shows the instruction alone
  if (!(q.type === 'text' && /^Welches Wort fehlt\?$/.test(q.prompt?.de || ''))) card.appendChild(bilingual(i18n.pick(q.prompt), { cls: 'q' }));
  return card;
}
