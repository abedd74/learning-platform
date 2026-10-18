// The 19 badges of Deutsch mit Ella (ids as in gram_badges_<P>), with their conditions.
import { UNLOCK_AKK, UNLOCK_DAT } from './rules.js';

export const BADGES = Object.freeze([
  { id: 'goal1',    em: '🎯', lbl: 'Erstes Tagesziel',         cond: f => f.goalToday },
  { id: 'w10',      em: '🥉', lbl: '10 Wörter gemeistert',     cond: f => f.m >= 10 },
  { id: 'w25',      em: '🥈', lbl: '25 Wörter gemeistert',     cond: f => f.m >= 25 },
  { id: 'w50',      em: '🥇', lbl: '50 Wörter gemeistert',     cond: f => f.m >= 50 },
  { id: 'w100',     em: '💎', lbl: '100 Wörter gemeistert',    cond: f => f.m >= 100 },
  { id: 'w200',     em: '👑', lbl: '200 Wörter gemeistert',    cond: f => f.m >= 200 },
  { id: 'streak3',  em: '🔥', lbl: '3 Tage in Folge',          cond: f => f.streak >= 3 },
  { id: 'streak7',  em: '🚀', lbl: '7 Tage in Folge',          cond: f => f.streak >= 7 },
  { id: 'streak14', em: '🌟', lbl: '14 Tage in Folge',         cond: f => f.streak >= 14 },
  { id: 'traps10',  em: '🇮🇹', lbl: '10 Fallen-Wörter besiegt', cond: f => f.traps >= 10 },
  { id: 'akk',      em: '✍️', lbl: 'Akkusativ freigeschaltet', cond: f => f.m >= UNLOCK_AKK },
  { id: 'pathakk',  em: '🕵️‍♀️', lbl: 'Akkusativ-Detektivin',     cond: f => f.pathAkkDone },
  { id: 'mcakk',    em: '🏆', lbl: 'Akkusativ-Meisterin',      cond: f => f.mcAkk },
  { id: 'pathdat',  em: '🕵️', lbl: 'Dativ-Detektivin',         cond: f => f.pathDatDone },
  { id: 'mcdat',    em: '🥇', lbl: 'Dativ-Meisterin',          cond: f => f.mcDat },
  { id: 'pathnom',  em: '🧩', lbl: 'Baustein-Detektivin',      cond: f => f.pathNomDone },
  { id: 'mcnom',    em: '🏗️', lbl: 'Baustein-Meisterin',       cond: f => f.mcNom },
  { id: 'dat',      em: '✉️', lbl: 'Dativ freigeschaltet',     cond: f => f.m >= UNLOCK_DAT },
  { id: 'perfect',  em: '🏆', lbl: 'Perfekte Runde',           cond: (f, x) => !!x.perfect },
]);

/** New badges earned now: returns the fresh ones and the updated map {id: day}. */
export function checkBadges(earned, facts, extra, today) {
  const map = { ...(earned || {}) };
  const fresh = [];
  for (const b of BADGES) {
    if (!map[b.id] && b.cond(facts, extra || {})) { map[b.id] = today; fresh.push(b); }
  }
  return { fresh, earned: map };
}
