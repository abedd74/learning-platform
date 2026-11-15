// A learning session: serves the planned cards one by one, checks answers,
// allows one retry with the hint (as the old app), updates the records and
// the day's counters, re-asks missed cards later in the session, and writes
// the round into the history. No DOM: the session screen drives it.
//
//   const s = createSession({ items, profile, store, today, now, rng, module, mode })
//   s.current()            → { item, index, total, attempt, rehearsal }
//   s.answer(response)     → { ok, final, outcome, expected }   (final=false → retry allowed)
//   s.giveUp()             → the same, final and wrong: "Weiß ich nicht" — the way out of any card
//   s.next()               → true while there is a next card
//   s.finish()             → summary (also writes history + session time)
//
// items: [{ card, question }]
//   card.store  'quizSrs' | 'gramSrs' | 'mapSrs'   which record store the card lives in;
//               null for an item without a record (a grammar sentence): it is
//               counted as an answer, never as a new card
//   card.cfg    srs config of its module
//   question.type decides the renderer and the checker

import { keys as K } from './storage.js';
import { review, isNew, config as srsConfig, summarize, cardId } from './srs.js';
import { recordAnswer, recordSession, rehearse, DEFAULTS as PLAN } from './planner.js';
import { today as todayOf, toLegacyDate } from './time.js';
import { check } from '../engines/quiz/check.js';

export const STORE_KEY = { quizSrs: K.quizSrs, gramSrs: K.gramSrs, mapSrs: K.mapSrs };

export function createSession({
  items, profile, store, today = todayOf(), now = Date.now, module = 'mixed', mode = 'mixed', label = null,
  rehearsalGap = PLAN.rehearsalGap, maxAttempts = 2, rng = Math.random,
}) {
  if (!profile) throw new TypeError('session: profile is required');
  const queue = items.map(it => ({ ...it, rehearsal: false }));
  let index = 0;
  let attempt = 0;
  const results = [];                 // one per final answer of a non-rehearsal card
  const topicPts = {};                // {topic: {pts, max}} as the old round history
  const startedAt = now();
  let finished = false;
  let last = null;                    // the final result of the current card, until next()

  const current = () => (index < queue.length ? { item: queue[index], index, total: queue.length, attempt, rehearsal: queue[index].rehearsal } : null);

  function applyRecord(card, outcome) {
    const key = STORE_KEY[card.store]?.(profile);
    if (!key) return null;
    const all = store.get(key, {}) || {};
    // the store is the truth (the card's snapshot may be a round old); "new" means: no record yet
    const before = all[card.id] ?? card.rec;
    const wasNew = isNew(before);
    const rec = review(before, outcome, today, srsConfig(card.cfg || {}), rng);
    all[card.id] = rec;
    store.set(key, all);
    return { rec, all, wasNew };
  }

  function applyStats(card, outcome) {
    if (card.store !== 'quizSrs') return;
    const key = K.quizStats(profile);
    const st = store.get(key, {}) || {};
    const e = st[card.id] || { shown: 0, correct: 0, wrong: 0, lastSeen: '' };
    e.shown++;
    if (outcome === 'first') e.correct++; else e.wrong++;
    e.lastSeen = toLegacyDate(today);
    st[card.id] = e;
    store.set(key, st);
  }

  function applyDay(card, outcome, wasNew, updated) {
    store.set(K.planDays(profile), recordAnswer(store.get(K.planDays(profile), {}), today, { first: outcome === 'first', isNew: wasNew, module: card.module }));
    if (card.store === 'gramSrs' || card.tags?.includes('grammar')) {
      // the old trainer's day counters, kept for its dashboard and badges
      const days = store.get(K.gramDays(profile), {}) || {};
      const d = { a: 0, c: 0, ...(days[today] || {}) };
      d.a++; if (outcome === 'first') d.c++;
      if (wasNew) d.n = (d.n || 0) + 1;
      const all = updated ? updated.all : (store.get(K.gramSrs(profile), {}) || {});
      d.m = summarize(all, today, srsConfig(card.cfg || {})).mastered;
      store.set(K.gramDays(profile), { ...days, [today]: d });
    }
  }

  /** Answer the current card. Returns {ok, final, outcome?, expected}. */
  function answer(response) {
    const cur = current();
    if (!cur || finished) throw new Error('session: no current card');
    if (last) return last;            // a second tap on a card that is already decided changes nothing
    const { item } = cur;
    const { ok, expected } = check(item.question, response);
    attempt++;
    try { item.card.onAnswer?.({ ok, attempt, response, final: ok || attempt >= maxAttempts, rehearsal: item.rehearsal }); } catch {}
    if (ok || attempt >= maxAttempts) return settle(item, ok, expected);
    return { ok, final: false, expected };
  }

  /**
   * "Weiß ich nicht": the child cannot or will not answer. The card is closed
   * as a wrong answer — the solution is shown, the record goes down as for any
   * wrong answer, and the card comes back later in the round. Without this a
   * child who is stuck could only guess or leave the whole round.
   */
  function giveUp() {
    const cur = current();
    if (!cur || finished) throw new Error('session: no current card');
    if (last) return last;
    const { item } = cur;
    let expected;
    try { expected = check(item.question, null).expected; } catch {}
    attempt++;
    try { item.card.onAnswer?.({ ok: false, attempt, response: null, final: true, rehearsal: item.rehearsal, gaveUp: true }); } catch {}
    last = { ...settle(item, false, expected), gaveUp: true };
    return last;
  }

  /** The current card is decided: book the record, the day and the re-ask. */
  function settle(item, ok, expected) {
    const outcome = ok ? (attempt === 1 ? 'first' : 'retry') : 'wrong';
    if (!item.rehearsal) {
      const card = item.card;
      const t = topicPts[card.topic || '_'] || (topicPts[card.topic || '_'] = { pts: 0, max: 0 });
      t.max += 2; if (ok) t.pts += attempt === 1 ? 2 : 1;
      const updated = applyRecord(card, outcome);
      const wasNew = !!updated?.wasNew;
      applyStats(card, outcome);
      applyDay(card, outcome, wasNew, updated);
      results.push({ id: card.id, module: card.module, topic: card.topic, store: card.store || null, outcome, wasNew, reason: card.reason, concept: card.concept, tags: card.tags });
      if (outcome !== 'first') {
        // re-ask later in the session; the re-ask changes no record
        const rest = rehearse(queue.slice(index + 1), { ...item, rehearsal: true }, rehearsalGap);
        queue.splice(index + 1, queue.length - index - 1, ...rest);
      }
    } else {
      results.push({ id: item.card.id, module: item.card.module, topic: item.card.topic, outcome, rehearsal: true });
    }
    last = { ok, final: true, outcome, expected };
    return last;
  }

  function next() {
    if (current() && attempt === 0) throw new Error('session: answer first');
    index++; attempt = 0; last = null;
    return index < queue.length;
  }

  function summary() {
    const own = results.filter(r => !r.rehearsal);
    const firstTry = own.filter(r => r.outcome === 'first').length;
    const retried = own.filter(r => r.outcome === 'retry').length;
    const wrong = own.filter(r => r.outcome === 'wrong').length;
    const pts = Object.values(topicPts).reduce((a, t) => a + t.pts, 0);
    const max = Object.values(topicPts).reduce((a, t) => a + t.max, 0);
    return {
      total: own.length, firstTry, retried, wrong,
      newCount: own.filter(r => r.wasNew).length,
      pct: max ? pts / max : 0,
      topicPts, results, durationMs: now() - startedAt,
      modules: [...new Set(own.map(r => r.module))],
    };
  }

  /**
   * Close the session: the day's session time, and the round history.
   * The history (wq_<P>) is the old quiz's list of its last 10 rounds, in its
   * shape — pct is a whole number 0–100 — and the old page still reads it. So
   * it gets what the old quiz put there: a round that was played to the end
   * and consisted of one quiz module's questions. Trainer rounds, mixed
   * rounds and rounds that were left early are counted in plan_days only.
   */
  function finish() {
    if (finished) return summary();
    const complete = index >= queue.length;
    finished = true;
    const s = summary();
    if (s.total) {
      const own = results.filter(r => !r.rehearsal);
      const quizModules = [...new Set(own.filter(r => r.store === 'quizSrs').map(r => r.module))];
      if (complete && quizModules.length === 1 && own.every(r => r.store === 'quizSrs')) {
        const key = K.quizHistory(profile);
        const hist = store.get(key, []);
        const list = Array.isArray(hist) ? hist : [];
        const d = new Date(now());
        list.push({
          date: toLegacyDate(today),
          time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
          mode, pct: Math.round(s.pct * 100), module: quizModules[0],
          topics: Object.fromEntries(Object.entries(topicPts).map(([k, v]) => [k, { ...v }])),
        });
        while (list.length > 10) list.shift();
        store.set(key, list);
      }
      store.set(K.planDays(profile), recordSession(store.get(K.planDays(profile), {}), today, s.durationMs));
    }
    return s;
  }

  return { current, answer, giveUp, next, finish, summary, label, get finished() { return finished; }, get size() { return queue.length; } };
}

/** Helper for callers: a card id for a quiz question. */
export { cardId };
