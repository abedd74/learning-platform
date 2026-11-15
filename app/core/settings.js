// Device settings (app_settings: {sound, italian, …}) and their first values.
//
// The old pages kept three separate switches: the trainer's sound and Italian
// (gram_sound_on, gram_it_on: JSON booleans) and the game's sound (wr_sound:
// '0' or '1'). On the first start of the new app on a device they are read
// once, so that nothing changes for the child: a device where the Italian
// line was on keeps it, a device that was muted stays muted. The old keys
// are never written (they are read-only in the registry).

import { keys as K } from './storage.js';

/** Fill sound / italian from the old switches when they are not set yet. Returns what was added. */
export function seedLegacySettings(store) {
  const cur = store.get(K.appSettings(), null) || {};
  const add = {};
  const bool = key => { try { const v = JSON.parse(store.getRaw(key) ?? 'null'); return typeof v === 'boolean' ? v : null; } catch { return null; } };
  if (typeof cur.italian !== 'boolean') {
    const it = bool(K.gramItalian());
    if (it !== null) add.italian = it;
  }
  if (typeof cur.sound !== 'boolean') {
    const trainer = bool(K.gramSound());
    const game = store.getRaw(K.wrSound());
    if (trainer !== null) add.sound = trainer;
    else if (game === '0' || game === '1') add.sound = game === '1';
  }
  if (Object.keys(add).length) store.set(K.appSettings(), { ...cur, ...add });
  return add;
}
