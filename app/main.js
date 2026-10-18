// Wires the core and the screens together. Loaded by boot.js with the
// version as a cache-breaker; start() is called once.
import { createStore, keys as K } from './core/storage.js';
import { createFamilySync } from './core/sync.js';
import { createErrorLog } from './core/errors.js';
import { createAudio } from './core/audio.js';
import { createI18n } from './core/i18n.js';
import { createContent } from './core/content.js';
import { createRouter, profileFromSearch } from './core/router.js';
import { createSession } from './core/session.js';
import { planSession, config as planConfig } from './core/planner.js';
import { config as srsConfig } from './core/srs.js';
import { today as todayOf } from './core/time.js';
import { listProfiles, getProfile, currentProfileKey, setCurrentProfile } from './core/profiles.js';
import { STRINGS } from './ui/strings.js';
import { el, mount } from './ui/dom.js';
import { renderWelcome } from './ui/screens/welcome.js';
import { renderHome } from './ui/screens/home.js';
import { renderModule } from './ui/screens/module.js';
import { renderSessionScreen } from './ui/screens/session.js';
import { renderResults } from './ui/screens/results.js';
import { createEllaModule } from './engines/ella/index.js';

const TINTS = { whales: 'var(--m-whales)', nouns: 'var(--m-ella)', states: 'var(--m-states)', water: 'var(--m-archive)', book: 'var(--m-archive)', magnetism: 'var(--m-archive)' };

export async function start({ version = 'dev' } = {}) {
  const root = document.getElementById('app') || document.body.appendChild(el('div', { id: 'app' }));
  const namespace = globalThis.LP_NAMESPACE || '';
  let sync;
  const store = createStore({ namespace, onDirty: k => sync?.markDirty(k), onRemove: k => sync?.remove(k) });
  sync = createFamilySync({ store });
  const errors = createErrorLog({ store, version, page: () => location.hash });
  errors.install();
  const audio = createAudio({ store, clipUrl: name => new URL(`../audio/${name}.mp3`, import.meta.url).href });
  const i18n = createI18n({ store, strings: STRINGS });
  const content = createContent();
  const plannerCfg = planConfig();
  const pending = {};
  const live = { session: null, summary: null, after: null, extras: null };

  const ctx = {
    version, namespace, store, sync, errors, audio, i18n, content, plannerCfg,
    assetsBase: new URL('../assets/', import.meta.url).href,
    modules: [], games: {}, profile: null, lastSessionConfig: null, lastHomeConfig: null, router: null,
    go(name, params = {}) {
      if (params.form) pending.form = params.form;
      router.navigate([name, ...(params.id ? [params.id] : [])], params.form ? { form: '1' } : {});
    },
    moduleName(id) { return ctx.modules.find(m => m.id === id)?.name?.de || id; },
    get ella() { return ctx.modules.find(m => m.engine === 'ella') || null; },
    async cardsOf(mod) {
      if (mod.engine !== 'quiz') return mod.cards ? mod.cards(ctx) : [];
      const qs = await content.questions(mod);
      return content.cardsFor(mod, qs, store.get(K.quizSrs(ctx.profile.key), {}) || {}, { cfg: mod.srs });
    },
    async allCards() {
      const lists = await Promise.all(ctx.modules.filter(m => !m.archive).map(m => ctx.cardsOf(m)));
      return lists.flat();
    },
    /**
     * Start a session. Either `cards` (planned here; `grammar` adds Ella's grammar items)
     * or ready-made `items`. `after(summary)` may return extras for the results screen.
     */
    startSession({ cards = null, items = null, module = 'mixed', mode = 'mixed', grammar = false, label = null, after = null, skipCheck = false }) {
      const today = todayOf();
      const ella = ctx.ella;
      // a Meister-Check that waited too long comes first (old trainer rule)
      if (!skipCheck && cards && ella && (module === 'mixed' || module === 'nouns')) {
        const k = ella.overdueCheck();
        if (k) { ctx.lastHomeConfig = { cards, module, mode, grammar }; ella.startMc(k, true); return; }
      }
      let list = items;
      if (!list) {
        const extra = grammar && ella ? ella.extraItems(4) : [];
        const dayRec = store.get(K.planDays(ctx.profile.key), {})?.[today] || null;
        const plan = store.get(K.plan(ctx.profile.key), null);
        const planned = planSession({ cards, today, dayRecord: dayRec, plan, cfg: { ...plannerCfg, sessionSize: Math.max(1, plannerCfg.sessionSize - extra.length) } });
        list = planned.cards.map(card => ({ card, question: card.question }));
        for (const it of extra) list.splice(Math.floor(Math.random() * (list.length + 1)), 0, it);
      }
      ctx.lastSessionConfig = { cards, items, module, mode, grammar, label, after, skipCheck: true };
      ctx.ellaStartMastered = ella ? ella.masteredNow() : 0;
      live.after = after || (ella && (grammar || module === 'mixed' || module === 'nouns') ? sum => ella.afterTraining(sum, ctx.ellaStartMastered) : null);
      live.session = createSession({ items: list, profile: ctx.profile.key, store, today, module, mode, label });
      router.navigate(['session']);
    },
  };

  async function loadModules() {
    const index = await content.index();
    const out = [];
    for (const m of index) {
      if (m.kind === 'quiz') {
        const mod = await content.module(m.id);
        if (!mod) continue;
        const count = (await content.questions(mod)).length;
        out.push({ ...mod, srs: srsConfig(mod.srs || {}), count, tint: TINTS[m.id] || 'var(--card-tint)' });
      } else if (m.kind === 'pack' && m.id === 'nouns') {
        const data = await content.nounPack(m.id);
        if (data) out.push(createEllaModule(ctx, data));
      }
    }
    ctx.modules = out;
  }

  function requireProfile() {
    const key = currentProfileKey(store) || profileFromSearch(location.search);
    const p = key ? getProfile(store, key) : null;
    if (p) { ctx.profile = p; if (!currentProfileKey(store)) setCurrentProfile(store, p.key); return true; }
    return false;
  }

  const screens = {
    async welcome() { ctx.profile = null; renderWelcome(root, ctx, { form: pending.form }); pending.form = null; },
    async home() { if (!requireProfile()) return screens.welcome(); await renderHome(root, ctx); },
    async module(id) { if (!requireProfile()) return screens.welcome(); await renderModule(root, ctx, { id }); },
    async ella(sub, id) { if (!requireProfile()) return screens.welcome(); const m = ctx.ella; if (m) await m.route(root, ctx, sub, id); else router.navigate(['home']); },
    async game(id) { if (!requireProfile()) return screens.welcome(); const g = ctx.games?.[id]; if (g) await g(root, ctx); else router.navigate(['home']); },
    async session() {
      if (!requireProfile() || !live.session) return router.navigate(['home'], {}, { replace: true });
      renderSessionScreen(root, ctx, live.session, {
        onDone: summary => {
          live.summary = summary; live.session = null;
          try { live.extras = live.after ? live.after(summary) : null; } catch (err) { errors.record(err); live.extras = null; }
          router.navigate(['results'], {}, { replace: true });
        },
        onQuit: () => { live.session = null; router.navigate(['home'], {}, { replace: true }); },
      });
    },
    async results() {
      if (!requireProfile() || !live.summary) return router.navigate(['home'], {}, { replace: true });
      renderResults(root, ctx, live.summary, {
        extras: live.extras,
        onAgain: () => { const c = ctx.lastSessionConfig; live.summary = null; if (c) ctx.startSession(c); else router.navigate(['home']); },
        onDone: () => { live.summary = null; router.navigate(['home'], {}, { replace: true }); },
      });
    },
    async eltern() { const mod = await import('./ui/screens/eltern.js').catch(() => null); if (mod) await mod.renderEltern(root, ctx); else router.navigate(['home']); },
  };

  const router = createRouter({
    onChange: async route => {
      const [name, ...rest] = route.path;
      const fn = screens[name] || (listProfiles(store).length && currentProfileKey(store) ? screens.home : screens.welcome);
      try { await fn(...rest); }
      catch (err) { errors.record(err); mount(root, el('div', { class: 'col' }, el('div', { class: 'notice' }, i18n.t('error.content'), ' ', String(err?.message || err)))); }
    },
  });
  ctx.router = router;

  try { await loadModules(); }
  catch (err) { errors.record(err); mount(root, el('div', { class: 'col' }, el('div', { class: 'notice' }, i18n.t('error.content'), ' ', String(err?.message || err)))); return; }
  document.addEventListener('pointerdown', () => audio.unlock(), { once: true, passive: true });
  window.addEventListener('familysync-pulled', () => { if (['home', 'module'].includes(router.current.path[0])) router.navigate(router.current.path, router.current.params, { replace: true }); });
  sync.init();
  router.start();
  return ctx;
}
