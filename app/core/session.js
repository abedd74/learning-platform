// A learning session: serves the planned cards one by one, checks answers,
// allows one retry with the hint (as the old app), updates the records and
// the day's counters, re-asks missed cards later in the session, and writes
// the round into the history. No DOM: the session screen drives it.
//
//   const s = createSession({ items, profile, store, today, now, rng, module, mode })
//   s.current()            → { item, index, total, attempt, rehearsal }
//   s.answer(response)     → { ok, final, outcome, expected }   (final=false → retry allowed)
//   s.next()               → true while there is a next card
//   s.finish()             → summary (also writes history + session time)
//
// items: [{ card, question }]
//   card.store  'quizSrs' | 'gramSrs' | 'mapSrs'   which record store the card lives in
//   card.cfg    srs config of its module
//   question.type decides the renderer and the checker

import { keys as K } from './storage.js';
import { review, isNew, config as srsConfig, summarize, cardId } from './srs.js';
import { recordAnswer, recordSession, rehearse, DEFAULTS as PLAN } from './planner.js';
import { today as todayOf, toLegacyDate } from './time.js';
import { check } from '../engines/quiz/check.js';

const STORE_KEY = { quizSrs: K.quizSrs, gramSrs: K.gramSrs, mapSrs: K.mapSrs };

export function createSession({
  items, profile, store, today = todayOf(), now = Date.now, module = 'mixed', mode = 'mixed',
  rehearsalGap = PLAN.rehearsalGap, maxAttempts = 2,
}) {
  if (!profile) throw new TypeError('session: profile is required');
  const queue = items.map(it => ({ ...it, rehearsal: false }));
  let index = 0;
  let attempt = 0;
  const results = [];                 // one per final answer of a non-rehearsal card
  const topicPts = {};                // {topic: {pts, max}} as the old round history
  const startedAt = now();
  let finished = false;

  const current = () => (index < queue.length ? { item: queue[index], index, total: queue.length, attempt, rehearsal: queue[index].rehearsal } : null);

  function applyRecord(card, outcome) {
    const key = STORE_KEY[card.store]?.(profile);
    if (!key) return null;
    const all = store.get(key, {}) || {};
    // the store is the truth; the planner's snapshot only fills in when the store has nothing
    const rec = review(all[card.id] ?? card.rec, outcome, today, srsConfig(card.cfg || {}));
    all[card.id] = rec;
    store.set(key, all);
    return { rec, all };
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
    store.set(K.planDays(profile), recordAnswer(store.get(K.planDays(profile), {}), today, { first: outcome === 'first', isNew: wasNew }));
    if (card.store === 'gramSrs') {
      // the old trainer's day counters, kept for its dashboard and badges
      const days = store.get(K.gramDays(profile), {}) || {};
      const d = { a: 0, c: 0, ...(days[today] || {}) };
      d.a++; if (outcome === 'first') d.c++;
      if (wasNew) d.n = (d.n || 0) + 1;
      if (updated) d.m = summarize(updated.all, today, srsConfig(card.cfg || {})).mastered;
      store.set(K.gramDays(profile), { ...days, [today]: d });
    }
  }

  /** Answer the current card. Returns {ok, final, outcome?, expected}. */
  function answer(response) {
    const cur = current();
    if (!cur || finished) throw new Error('session: no current card');
    const { item } = cur;
    const { ok, expected } = check(item.question, response);
    attempt++;
    if (ok || attempt >= maxAttempts) {
      const outcome = ok ? (attempt === 1 ? 'first' : 'retry') : 'wrong';
      if (!item.rehearsal) {
        const card = item.card;
        const wasNew = isNew(card.rec);
        const t = topicPts[card.topic || '_'] || (topicPts[card.topic || '_'] = { pts: 0, max: 0 });
        t.max += 2; if (ok) t.pts += attempt === 1 ? 2 : 1;
        const updated = applyRecord(card, outcome);
        applyStats(card, outcome);
        applyDay(card, outcome, wasNew, updated);
        results.push({ id: card.id, module: card.module, topic: card.topic, outcome, wasNew, reason: card.reason });
        if (outcome !== 'first') {
          // re-ask later in the session; the re-ask changes no record
          const rest = rehearse(queue.slice(index + 1), { ...item, rehearsal: true }, rehearsalGap);
          queue.splice(index + 1, queue.length - index - 1, ...rest);
        }
      } else {
        results.push({ id: item.card.id, module: item.card.module, topic: item.card.topic, outcome, rehearsal: true });
      }
      return { ok, final: true, outcome, expected };
    }
    return { ok, final: false, expected };
  }

  function next() {
    if (current() && attempt === 0) throw new Error('session: answer first');
    index++; attempt = 0;
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

  /** Close the session: round history (old format) and the day's session time. Returns the summary. */
  function finish() {
    if (finished) return summary();
    finished = true;
    const s = summary();
    if (s.total) {
      const key = K.quizHistory(profile);
      const hist = store.get(key, []);
      const list = Array.isArray(hist) ? hist : [];
      const d = new Date(now());
      list.push({
        date: toLegacyDate(today),
        time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        mode, pct: s.pct, module,
        topics: Object.fromEntries(Object.entries(topicPts).map(([k, v]) => [k, { ...v }])),
      });
      while (list.length > 10) list.shift();
      store.set(key, list);
      store.set(K.planDays(profile), recordSession(store.get(K.planDays(profile), {}), today, s.durationMs));
    }
    return s;
  }

  return { current, answer, next, finish, summary, get finished() { return finished; }, get size() { return queue.length; } };
}

/** Helper for callers: a card id for a quiz question. */
export { cardId };
