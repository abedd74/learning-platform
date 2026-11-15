// Tiny DOM helpers. Text goes in through textContent, never innerHTML —
// except for the trainer's lessons, which pass the validator's tag list
// and go through lessonHtml().

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') { for (const [p, val] of Object.entries(v)) { if (p.startsWith('--')) node.style.setProperty(p, val); else node.style[p] = val; } }
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

// The signs of the round buttons are drawn, not typed: an emoji or an arrow
// from a font sits where that font puts it (on the iPad visibly off the
// middle); a drawing in its own square sits exactly in the middle everywhere.
const SVG = 'http://www.w3.org/2000/svg';
const ICONS = {
  close: [['path', { d: 'M6 6l12 12M18 6L6 18' }]],
  back: [['path', { d: 'M15.5 5l-7 7 7 7' }]],
  sound: [['path', { d: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z', fill: 'currentColor' }], ['path', { d: 'M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4' }]],
  mute: [['path', { d: 'M4 9.5h3.5L12 6v12l-4.5-3.5H4z', fill: 'currentColor' }], ['path', { d: 'M15.5 9.5l5 5M20.5 9.5l-5 5' }]],
  // the Italian flag: three bands in a rounded frame
  italian: [
    ['rect', { x: 2, y: 5, width: 20, height: 14, rx: 2.5, fill: '#fff', stroke: 'none' }],
    ['path', { d: 'M4.5 5h4.17v14H4.5A2.5 2.5 0 0 1 2 16.5v-9A2.5 2.5 0 0 1 4.5 5z', fill: '#2e9e5b', stroke: 'none' }],
    ['path', { d: 'M15.33 5h4.17A2.5 2.5 0 0 1 22 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-4.17z', fill: '#d8433b', stroke: 'none' }],
    ['rect', { x: 2, y: 5, width: 20, height: 14, rx: 2.5, fill: 'none', stroke: 'rgba(0,0,0,.18)', 'stroke-width': 1 }],
  ],
};

/** A drawn sign for a round button: 'close' | 'back' | 'sound' | 'mute' | 'italian'. */
export function icon(name) {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: 24, height: 24, fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false', class: `icon icon-${name}` })) svg.setAttribute(k, String(v));
  for (const [tag, attrs] of ICONS[name] || []) {
    const n = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    svg.appendChild(n);
  }
  return svg;
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
