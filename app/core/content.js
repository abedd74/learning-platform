// Loads content files (content/…) relative to the app, caches them, and
// turns a module's questions into cards for the planner.
//
// Static hosting has no directory listing, so content/index.json names the
// modules. Everything is fetched lazily and kept for the page's lifetime.

import { cardId } from './srs.js';

export function createContent({ base, fetch = globalThis.fetch?.bind(globalThis) } = {}) {
  // base: URL of the content folder (default: ../content/ next to app/)
  const root = base ?? new URL('../../content/', import.meta.url).href;
  const cache = new Map();

  async function json(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const p = (async () => {
      const res = await fetch(new URL(rel, root).href, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Inhalt fehlt: ${rel} (${res.status})`);
      return res.json();
    })();
    cache.set(rel, p);
    try { return await p; } catch (e) { cache.delete(rel); throw e; }
  }

  /** { quiz: ['whales', …], packs: ['nouns'] } in display order */
  async function index() {
    const i = await json('index.json');
    return { quiz: Array.isArray(i.quiz) ? i.quiz : [], packs: Array.isArray(i.packs) ? i.packs : [] };
  }

  /** module.json of a quiz module (null for a pack) */
  async function module(id) {
    try { return await json(`${id}/module.json`); }
    catch (e) { if (/404/.test(e.message)) return null; throw e; }
  }

  /** pack.json of a pack (null for a quiz module) */
  async function pack(id) {
    try { return await json(`${id}/pack.json`); }
    catch (e) { if (/404/.test(e.message)) return null; throw e; }
  }

  /** All quiz modules (module.json) in display order, with their id. */
  async function quizModules() {
    const { quiz } = await index();
    return Promise.all(quiz.map(id => json(`${id}/module.json`)));
  }

  /** The questions of one topic, each stamped with module and topic. */
  async function topic(mod, topicId) {
    const t = mod.topics.find(x => x.id === topicId);
    if (!t) throw new Error(`Thema ${topicId} fehlt in ${mod.id}`);
    const data = await json(`${mod.id}/${t.file}`);
    return (data.items || []).map(q => ({ ...q, module: mod.id, topic: topicId }));
  }

  /** All questions of a module, in topic order. */
  async function questions(mod) {
    const lists = await Promise.all(mod.topics.map(t => topic(mod, t.id)));
    return lists.flat();
  }

  /** The noun pack with its files loaded: {pack, nouns, categories, templates, paths:{akk,…}, wortbau}. */
  async function nounPack(id = 'nouns') {
    const p = await pack(id);
    if (!p) return null;
    const f = p.files;
    const [nouns, categories, templates, wortbau] = await Promise.all([
      json(`${id}/${f.nouns}`), json(`${id}/${f.categories}`), json(`${id}/${f.templates}`), json(`${id}/${f.wortbau}`),
    ]);
    const paths = {};
    for (const [k, file] of Object.entries(f.paths || {})) paths[k] = (await json(`${id}/${file}`)).units;
    return { pack: p, nouns: nouns.items, categories, templates, paths, wortbau: wortbau.items };
  }

  /** Planner cards for a quiz module: one card per question, records looked up in `srsStore`. */
  function cardsFor(mod, qs, srsStore, { cfg } = {}) {
    return qs.map(q => ({
      id: cardId(q.id), module: mod.id, topic: q.topic, store: 'quizSrs', cfg,
      rec: srsStore?.[q.id], question: q,
    }));
  }

  return { index, module, pack, quizModules, topic, questions, nounPack, cardsFor, root };
}
