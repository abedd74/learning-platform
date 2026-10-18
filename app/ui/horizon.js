// The "Stille See" atmosphere: a still lake with two gentle waves and a few
// stars at the bottom of every screen (DESIGN-UI direction B).
import { el } from './dom.js';

const SVG = 'http://www.w3.org/2000/svg';

export function horizon() {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 800 300');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const mk = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  svg.append(
    mk('circle', { cx: 120, cy: 60, r: 3, fill: '#fff' }),
    mk('circle', { cx: 700, cy: 40, r: 2.5, fill: '#fff' }),
    mk('circle', { cx: 420, cy: 90, r: 2, fill: '#fff', opacity: .8 }),
    mk('path', { d: 'M0 210 Q 100 190 200 210 T 400 210 T 600 210 T 800 210 L800 300 L0 300 Z', fill: 'var(--lake-1)' }),
    mk('path', { d: 'M0 250 Q 100 235 200 250 T 400 250 T 600 250 T 800 250 L800 300 L0 300 Z', fill: 'var(--lake-2)', opacity: .85 }),
  );
  return el('div', { class: 'horizon' }, svg);
}
