// Renders the answer area of a question and reports the child's response.
//
//   const r = renderAnswer(q, { i18n, onAnswer, rng })
//   r.node        the element to mount
//   r.reset()     re-enable for the retry (a wrong choice stays greyed out)
//   r.reveal({ ok, response, expected })   colour the result after the final answer
//
// Every type is touch-first: tiles instead of drag and drop, one tap per
// decision, a "Prüfen" button only where several taps make one answer.

import { el, clear, append, bilingual, focusLater } from '../../ui/dom.js';

const shuffle = (arr, rng = Math.random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

const T = (i18n, text) => i18n ? i18n.pick(text) : { de: text?.de ?? '', it: null };

function tile(i18n, text, onTap, extra = {}) {
  const b = el('button', { class: 'answer', type: 'button', onClick: onTap, ...extra });
  b.appendChild(bilingual(T(i18n, text)));
  return b;
}

// ── one tap decides ────────────────────────────────────────────────────
function choice(q, ctx) {
  const node = el('div', { class: 'answers' });
  const opts = (q.answer.options || []).map((o, i) => ({ o, i }));
  const order = q.type === 'image' || q.shuffle === false ? opts : shuffle(opts, ctx.rng);
  const buttons = new Map();
  for (const { o, i } of order) {
    const label = q.type === 'image' ? { de: `${o.emoji}  ${o.label?.de ?? ''}`, it: o.label?.it } : o;
    const b = tile(ctx.i18n, label, () => { disableAll(); b.classList.add('chosen'); ctx.onAnswer(i); });
    buttons.set(i, b);
    node.appendChild(b);
  }
  const disableAll = () => buttons.forEach(b => { b.disabled = true; });
  return {
    node,
    reset() { buttons.forEach(b => { b.disabled = b.classList.contains('no'); b.classList.remove('chosen'); }); },
    reveal({ ok, response, expected }) {
      buttons.forEach((b, i) => {
        if (i === expected) b.classList.add('ok');
        else if (i === response && !ok) b.classList.add('no');
      });
      disableAll();
    },
  };
}

function bool(q, ctx) {
  const node = el('div', { class: 'answers answers-2' });
  const mk = (val, key) => tile(ctx.i18n, { de: ctx.i18n.t(key), it: ctx.i18n.it(key) }, () => { yes.disabled = no.disabled = true; ctx.onAnswer(val); });
  const yes = mk(true, 'session.true'), no = mk(false, 'session.false');
  node.append(yes, no);
  return {
    node,
    reset() { [yes, no].forEach(b => { b.disabled = b.classList.contains('no'); }); },
    reveal({ ok, response, expected }) {
      const btn = v => (v ? yes : no);
      btn(expected).classList.add('ok');
      if (!ok) btn(response).classList.add('no');
      yes.disabled = no.disabled = true;
    },
  };
}

// ── several taps, then "Prüfen" ────────────────────────────────────────
function multi(q, ctx) {
  const node = el('div', { class: 'answers-wrap' });
  const grid = el('div', { class: 'answers' });
  const chosen = new Set();
  const buttons = new Map();
  (q.answer.options || []).forEach((o, i) => {
    const b = tile(ctx.i18n, o, () => { if (chosen.has(i)) chosen.delete(i); else chosen.add(i); b.classList.toggle('chosen', chosen.has(i)); check.disabled = chosen.size === 0; }, { 'aria-pressed': 'false' });
    buttons.set(i, b); grid.appendChild(b);
  });
  const check = el('button', { class: 'btn primary', type: 'button', disabled: true, onClick: () => { buttons.forEach(b => { b.disabled = true; }); check.disabled = true; ctx.onAnswer([...chosen]); } }, ctx.i18n.t('session.check'));
  node.append(grid, el('div', { class: 'row end' }, check));
  return {
    node,
    reset() { chosen.clear(); buttons.forEach(b => { b.disabled = false; b.classList.remove('chosen'); }); check.disabled = true; },
    reveal({ ok, expected }) {
      buttons.forEach((b, i) => { if (expected.includes(i)) b.classList.add('ok'); else if (b.classList.contains('chosen')) b.classList.add('no'); b.disabled = true; });
      check.disabled = true;
    },
  };
}

function text(q, ctx) {
  const node = el('div', { class: 'answers-wrap' });
  const a = q.answer;
  const line = el('div', { class: 'fill' });
  const input = el('input', { type: 'text', class: 'fill-input', autocapitalize: a.exact ? 'words' : 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: false, lang: a.lang || 'de', 'aria-label': ctx.i18n.t('session.type') });
  const pre = T(ctx.i18n, a.prefix), suf = T(ctx.i18n, a.suffix);
  line.append(el('span', { class: 'fill-text' }, pre.de), input, el('span', { class: 'fill-text' }, suf.de));
  const it = (pre.it || suf.it) ? el('div', { class: 'it fill-it' }, `${pre.it || ''} ___ ${suf.it || ''}`) : null;
  const submit = () => { if (!input.value.trim()) { input.focus(); return; } input.disabled = true; check.disabled = true; ctx.onAnswer(input.value); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  const check = el('button', { class: 'btn primary', type: 'button', onClick: submit }, ctx.i18n.t('session.check'));
  append(node, [line, it, el('div', { class: 'row end' }, check)]);
  focusLater(input);
  return {
    node,
    reset() { input.disabled = false; check.disabled = false; input.value = ''; input.classList.remove('no'); focusLater(input); },
    reveal({ ok, expected }) {
      input.disabled = true; check.disabled = true;
      input.classList.add(ok ? 'ok' : 'no');
      if (!ok) node.appendChild(el('div', { class: 'solution' }, `${ctx.i18n.t('session.solution')} `, el('b', {}, String(expected))));
    },
  };
}

function order(q, ctx) {
  const node = el('div', { class: 'answers-wrap' });
  const items = (q.answer.items || []).map((o, i) => ({ o, i }));
  const pool = el('div', { class: 'answers order-pool' });
  const picked = el('ol', { class: 'order-picked' });
  const chosen = [];
  const buttons = new Map();
  const render = () => {
    clear(picked);
    chosen.forEach((i, n) => picked.appendChild(el('li', {}, el('button', { type: 'button', class: 'order-item', onClick: () => { chosen.splice(n, 1); buttons.get(i).disabled = false; render(); } }, el('span', { class: 'order-n' }, String(n + 1)), bilingual(T(ctx.i18n, items[i].o))))));
    check.disabled = chosen.length !== items.length;
  };
  for (const { o, i } of shuffle(items, ctx.rng)) {
    const b = tile(ctx.i18n, o, () => { b.disabled = true; chosen.push(i); render(); });
    buttons.set(i, b); pool.appendChild(b);
  }
  const check = el('button', { class: 'btn primary', type: 'button', disabled: true, onClick: () => { check.disabled = true; picked.querySelectorAll('button').forEach(b => { b.disabled = true; }); ctx.onAnswer(chosen.slice()); } }, ctx.i18n.t('session.check'));
  node.append(picked, pool, el('div', { class: 'row end' }, check));
  return {
    node,
    reset() { chosen.length = 0; buttons.forEach(b => { b.disabled = false; }); render(); },
    reveal({ ok, expected }) {
      picked.querySelectorAll('li').forEach((li, n) => li.classList.add(chosen[n] === expected[n] ? 'ok' : 'no'));
      pool.querySelectorAll('button').forEach(b => { b.disabled = true; });
      if (!ok) node.appendChild(el('div', { class: 'solution' }, `${ctx.i18n.t('session.solution')} `, expected.map(i => T(ctx.i18n, items[i].o).de).join(' → ')));
    },
  };
}

function pairs(q, ctx) {
  const node = el('div', { class: 'answers-wrap' });
  const ps = q.answer.pairs || [];
  const left = el('div', { class: 'pairs-col' }), right = el('div', { class: 'pairs-col' });
  const map = {};                     // leftIndex → rightIndex
  let activeLeft = null;
  const L = new Map(), R = new Map();
  const paint = () => {
    L.forEach((b, i) => { b.classList.toggle('chosen', activeLeft === i); b.classList.toggle('linked', i in map); b.dataset.n = i in map ? String(Object.keys(map).indexOf(String(i)) + 1) : ''; });
    R.forEach((b, j) => { const li = Object.keys(map).find(k => map[k] === j); b.classList.toggle('linked', li !== undefined); b.dataset.n = li !== undefined ? String(Object.keys(map).indexOf(li) + 1) : ''; });
    check.disabled = Object.keys(map).length !== ps.length;
  };
  ps.forEach((p, i) => { const b = tile(ctx.i18n, p.left, () => { activeLeft = i; if (i in map) delete map[i]; paint(); }); L.set(i, b); left.appendChild(b); });
  shuffle(ps.map((p, j) => ({ p, j })), ctx.rng).forEach(({ p, j }) => {
    const b = tile(ctx.i18n, p.right, () => {
      if (activeLeft === null) return;
      for (const k of Object.keys(map)) if (map[k] === j) delete map[k];
      map[activeLeft] = j; activeLeft = null; paint();
    });
    R.set(j, b); right.appendChild(b);
  });
  const check = el('button', { class: 'btn primary', type: 'button', disabled: true, onClick: () => { check.disabled = true; [...L.values(), ...R.values()].forEach(b => { b.disabled = true; }); ctx.onAnswer({ ...map }); } }, ctx.i18n.t('session.check'));
  node.append(el('div', { class: 'pairs' }, left, right), el('div', { class: 'row end' }, check));
  paint();
  return {
    node,
    reset() { for (const k of Object.keys(map)) delete map[k]; activeLeft = null; [...L.values(), ...R.values()].forEach(b => { b.disabled = false; b.classList.remove('ok', 'no'); }); paint(); },
    reveal({ ok }) {
      L.forEach((b, i) => b.classList.add(map[i] === i ? 'ok' : 'no'));
      R.forEach((b, j) => { const li = Object.keys(map).find(k => map[k] === j); b.classList.add(li !== undefined && Number(li) === j ? 'ok' : 'no'); });
      if (!ok) node.appendChild(el('div', { class: 'solution' }, `${ctx.i18n.t('session.solution')} `, ps.map(p => `${T(ctx.i18n, p.left).de} – ${T(ctx.i18n, p.right).de}`).join(' · ')));
    },
  };
}

function cycle(q, ctx) {
  const steps = ctx.cycleSteps?.[q.answer.lang] || [];
  const node = el('div', { class: 'answers-wrap' });
  const ring = el('ol', { class: 'cycle' });
  steps.forEach((s, i) => ring.appendChild(el('li', { class: i === q.answer.gapStep ? 'gap' : '' }, i === q.answer.gapStep ? '?' : s)));
  const inner = choice({ ...q, type: 'choice' }, ctx);
  node.append(ring, inner.node);
  return { node, reset: inner.reset, reveal: r => { inner.reveal(r); ring.children[q.answer.gapStep].textContent = steps[q.answer.gapStep]; ring.children[q.answer.gapStep].classList.add('filled'); } };
}

// ── Deutsch mit Ella ───────────────────────────────────────────────────
function gender(q, ctx) {
  if (q.typed) return typedGender(q, ctx);
  const node = el('div', { class: 'answers answers-3 gender' });
  const buttons = new Map();
  for (const g of ['der', 'die', 'das']) {
    const b = el('button', { class: `answer g-${g}`, type: 'button', onClick: () => { buttons.forEach(x => { x.disabled = true; }); b.classList.add('chosen'); ctx.onAnswer(g); } }, g);
    buttons.set(g, b); node.appendChild(b);
  }
  return {
    node,
    reset() { buttons.forEach(b => { b.disabled = b.classList.contains('no'); b.classList.remove('chosen'); }); },
    reveal({ ok, response, expected }) { buttons.get(expected)?.classList.add('ok'); if (!ok) buttons.get(response)?.classList.add('no'); buttons.forEach(b => { b.disabled = true; }); },
  };
}

function options(q, ctx) {
  // case drills and Lernpfad items: a list of strings, one tap
  const node = el('div', { class: 'answers answers-3' });
  const buttons = new Map();
  for (const o of q.opts || []) {
    const b = el('button', { class: 'answer', type: 'button', onClick: () => { buttons.forEach(x => { x.disabled = true; }); b.classList.add('chosen'); ctx.onAnswer(o); } }, o);
    buttons.set(o, b); node.appendChild(b);
  }
  return {
    node,
    reset() { buttons.forEach(b => { b.disabled = b.classList.contains('no'); b.classList.remove('chosen'); }); },
    reveal({ ok, response, expected }) { buttons.get(expected)?.classList.add('ok'); if (!ok) buttons.get(response)?.classList.add('no'); buttons.forEach(b => { b.disabled = true; }); },
  };
}

function typedGender(q, ctx) {
  const node = el('div', { class: 'answers-wrap' });
  const input = el('input', { type: 'text', class: 'fill-input', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', spellcheck: false, lang: 'de', placeholder: 'der / die / das', 'aria-label': ctx.i18n.t('session.gender') });
  const note = el('div', { class: 'hint', hidden: true }, 'Schreibe der, die oder das! ✏️');
  const submit = () => {
    const v = input.value.trim().toLowerCase();
    if (!v) { input.focus(); return; }
    if (!['der', 'die', 'das'].includes(v)) { note.hidden = false; input.select(); return; }
    note.hidden = true; input.disabled = true; check.disabled = true; ctx.onAnswer(v);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
  const check = el('button', { class: 'btn primary', type: 'button', onClick: submit }, ctx.i18n.t('session.check'));
  append(node, [el('div', { class: 'fill' }, input, el('span', { class: 'fill-text' }, q.noun.de)), note, el('div', { class: 'row end' }, check)]);
  focusLater(input);
  return {
    node,
    reset() { input.disabled = false; check.disabled = false; input.value = ''; input.classList.remove('no'); focusLater(input); },
    reveal({ ok, expected }) { input.disabled = true; check.disabled = true; input.classList.add(ok ? 'ok' : 'no'); if (!ok) node.appendChild(el('div', { class: 'solution' }, `${ctx.i18n.t('session.solution')} `, el('b', {}, `${expected} ${q.noun.de}`))); },
  };
}

export const RENDERERS = { choice, image: choice, multi, bool, text, order, pairs, cycle, gender, case: options, pmcq: options, pfill: options };

export function renderAnswer(q, ctx) {
  const r = RENDERERS[q.type];
  if (!r) throw new Error(`Unbekannter Fragetyp: ${q.type}`);
  return r(q, ctx);
}

/** The small instruction above the question, per type. */
export function instructionKey(type) {
  return { choice: 'session.choose', image: 'session.choose', cycle: 'session.cycle', multi: 'session.choose.multi', bool: 'session.truefalse', text: 'session.type', order: 'session.order', pairs: 'session.pairs', gender: 'session.gender', case: 'session.choose', pmcq: 'session.choose', pfill: 'session.choose' }[type] || 'session.choose';
}
