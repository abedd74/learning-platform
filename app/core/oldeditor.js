// The old app had an editor for questions. What a parent changed there was
// kept on the device and in the family cloud (wq_editor_QB…: one entry per
// module, {topic: [questions], __meta: {topics: {topic: {ts}}}}) and replaced
// the built-in questions of that topic while the old app ran.
//
// The new app ships its questions as content files and does not read these
// entries as content (docs/MIGRATION.md). This module only REPORTS what is
// there, so that nothing typed into the old editor is lost unnoticed at the
// switch: the parents' screen lists the topics, and a session folds them
// into the content files.

import { keyInfo } from './storage.js';

/** The old editor's key suffix → the module id of the new content. */
const MODULE_OF = { '': 'water', _book: 'book', _magnetism: 'magnetism', _whales: 'whales' };

/**
 * Topics the old editor saved on this device:
 * [{ module, topic, questions, ts }] — ts is the time of the last save (ms) or null.
 */
export function oldEditorChanges(store) {
  const out = [];
  for (const key of store.list()) {
    const info = keyInfo(key);
    if (!info || info.id !== 'editorBank') continue;
    const bank = store.get(key, null);
    if (!bank || typeof bank !== 'object' || Array.isArray(bank)) continue;
    const suffix = info.re.exec(key)?.[1] ?? '';
    const module = MODULE_OF[suffix] ?? (suffix.replace(/^_/, '') || 'water');
    const stamps = (bank.__meta && typeof bank.__meta === 'object' && bank.__meta.topics) || {};
    for (const [topic, list] of Object.entries(bank)) {
      if (topic === '__meta' || !Array.isArray(list)) continue;
      const ts = Number(stamps?.[topic]?.ts);
      out.push({ module, topic, questions: list.length, ts: Number.isFinite(ts) && ts > 0 ? ts : null });
    }
  }
  return out.sort((a, b) => a.module.localeCompare(b.module) || a.topic.localeCompare(b.topic));
}
