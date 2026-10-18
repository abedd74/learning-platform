// The error log: what broke on which device, visible in Eltern mode and
// synced to the family (app_errors, union, last 200). Messages are scrubbed
// so that no family code can end up in them.

import { keys as K } from './storage.js';
import { ERROR_LOG_MAX } from './merges.js';

const DEDUPE_MS = 5000;
const MAX_MSG = 300;
const MAX_STACK_LINES = 3;

/** Remove anything that could carry the family code, cap the length. */
export function scrub(text) {
  return String(text ?? '')
    .replace(/families\/[^/\s"'`)]+/g, 'families/…')
    .replace(/familie=[^&\s"'`)]+/g, 'familie=…')
    .replace(/family_sync_id['"`]?\s*[,:=]\s*['"`][^'"`]*['"`]/g, 'family_sync_id=…')
    .slice(0, 600);
}

export function toEntry(err, { version = '?', page = '', now = Date.now() } = {}) {
  const e = err instanceof Error ? err : (err && typeof err === 'object' && 'message' in err ? err : null);
  const msg = scrub(e ? `${e.name ? e.name + ': ' : ''}${e.message}` : String(err)).slice(0, MAX_MSG);
  const stack = e?.stack ? scrub(String(e.stack).split('\n').slice(0, MAX_STACK_LINES + 1).join('\n')) : '';
  return { ts: now, v: String(version), page: scrub(page).slice(0, 80), msg, stack };
}

export function createErrorLog({ store, version = '?', now = Date.now, page = () => '', log = console } = {}) {
  if (!store) throw new TypeError('errors: store is required');
  const KEY = K.appErrors();

  function list() {
    const arr = store.get(KEY, []);
    return Array.isArray(arr) ? arr.slice().sort((a, b) => (b?.ts || 0) - (a?.ts || 0)) : [];
  }

  /** Append one error (deduplicated within 5 s). Never throws. */
  function record(err, extra = {}) {
    try {
      const entry = toEntry(err, { version, page: extra.page ?? page(), now: now() });
      const arr = store.get(KEY, []);
      const cur = Array.isArray(arr) ? arr : [];
      const last = cur[cur.length - 1];
      if (last && last.msg === entry.msg && entry.ts - (last.ts || 0) < DEDUPE_MS) return last;
      cur.push(entry);
      store.set(KEY, cur.slice(-ERROR_LOG_MAX));
      log.error?.('[app]', entry.msg);
      return entry;
    } catch (e) {
      log.warn?.('[errors] could not record', e?.message);
      return null;
    }
  }

  function clear() { store.set(KEY, []); }

  /** Entries newer than the last time Eltern mode looked (for the red dot). */
  function unseen() {
    const seenAt = store.get(K.appSettings(), {})?.errorsSeenAt || 0;
    return list().filter(e => (e.ts || 0) > seenAt).length;
  }
  function markSeen() {
    const s = store.get(K.appSettings(), {}) || {};
    store.set(K.appSettings(), { ...s, errorsSeenAt: now() });
  }

  /** Hook window 'error' and 'unhandledrejection'. Returns a function that unhooks. */
  function install(target = globalThis) {
    const onError = ev => record(ev?.error ?? ev?.message ?? ev);
    const onReject = ev => record(ev?.reason ?? ev);
    target.addEventListener?.('error', onError);
    target.addEventListener?.('unhandledrejection', onReject);
    return () => { target.removeEventListener?.('error', onError); target.removeEventListener?.('unhandledrejection', onReject); };
  }

  return { record, list, clear, unseen, markSeen, install };
}
