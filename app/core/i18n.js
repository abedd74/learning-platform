// Languages: the app speaks German; the Italian toggle shows the Italian
// version underneath (as the old app did with its *_it fields). Content
// carries text as {de, it?}; UI strings live in a table keyed by id.

import { keys as K } from './storage.js';

export const LANGS = Object.freeze(['de', 'it']);

/** Fill {name} placeholders. */
export function format(template, params = {}) {
  return String(template ?? '').replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/** Normalise a content text: a string → {de}, an object → {de, it|null}. */
export function text(value) {
  if (value === null || value === undefined) return { de: '', it: null };
  if (typeof value === 'string') return { de: value, it: null };
  if (typeof value === 'object') {
    const de = typeof value.de === 'string' ? value.de : '';
    const it = typeof value.it === 'string' && value.it.trim() ? value.it : null;
    return { de, it };
  }
  return { de: String(value), it: null };
}

/**
 * strings: { id: { de: '…', it: '…' } }
 * The toggle is a device setting (app_settings.italian), default off.
 */
export function createI18n({ store, strings = {}, defaultItalian = false } = {}) {
  const settings = () => (store ? store.get(K.appSettings(), {}) || {} : {});

  function showItalian() {
    const s = settings();
    return typeof s.italian === 'boolean' ? s.italian : defaultItalian;
  }
  function setShowItalian(on) {
    if (!store) return;
    store.set(K.appSettings(), { ...settings(), italian: !!on });
  }

  /** German UI string with placeholders filled. Unknown ids come back as the id. */
  function t(id, params) {
    const s = strings[id];
    return format(s ? (typeof s === 'string' ? s : s.de) : id, params);
  }
  /** Italian UI string, or null when there is none or the toggle is off. */
  function it(id, params) {
    if (!showItalian()) return null;
    const s = strings[id];
    const v = s && typeof s === 'object' ? s.it : null;
    return v ? format(v, params) : null;
  }
  /** Content text → {de, it|null} honouring the toggle. */
  function pick(value) {
    const v = text(value);
    return { de: v.de, it: showItalian() ? v.it : null };
  }

  return { t, it, pick, text, format, get showItalian() { return showItalian(); }, setShowItalian };
}
