// Tiny DOM helpers. Text goes in through textContent, never innerHTML —
// except for the trainer's lessons, which pass the validator's tag list
// and go through lessonHtml().

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

export function mount(container, ...children) { return append(clear(container), children); }

/** A {de, it} text as two lines (Italian only when given). */
export function bilingual(text, { tag = 'div', cls = '' } = {}) {
  const n = el(tag, { class: cls });
  n.appendChild(el('span', { class: 'de' }, text?.de ?? ''));
  if (text?.it) n.appendChild(el('span', { class: 'it' }, text.it));
  return n;
}

/** Lesson HTML from the content files (validated tag list). */
export function lessonHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  // belt and braces: strip anything the validator would refuse
  for (const bad of tpl.content.querySelectorAll('script, iframe, img, object, embed, a')) bad.remove();
  for (const n of tpl.content.querySelectorAll('*')) for (const a of [...n.attributes]) if (!['class', 'style'].includes(a.name)) n.removeAttribute(a.name);
  const wrap = el('div', { class: 'lesson' });
  wrap.appendChild(tpl.content);
  return wrap;
}

export function on(node, event, handler, opts) { node.addEventListener(event, handler, opts); return () => node.removeEventListener(event, handler, opts); }

/** Run after the next paint (for enter animations). */
export function nextFrame(fn) { requestAnimationFrame(() => requestAnimationFrame(fn)); }

export function focusLater(node) { setTimeout(() => { try { node.focus({ preventScroll: true }); } catch {} }, 60); }
