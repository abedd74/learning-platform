// Wires the core and the screens together. Loaded by boot.js with the
// version as a cache-breaker; start() is called once.
import { createStore, keys as K } from './core/storage.js';
import { createFamilySync } from './core/sync.js';
import { createErrorLog } from './core/errors.js';
import { createAudio } from './core/audio.js';
import { createI18n } from './core/i18n.js';
import { createContent } from './core/content.js';
import { createRouter, profileFromSearch } from './core/router.js';
import { createSession, STORE_KEY } from './core/session.js';
import { seedLegacySettings } from './core/settings.js';
import { planSession, config as planConfig } from './core/planner.js';
import { config as srsConfig } from './core/srs.js';
import { today as todayOf } from './core/time.js';
import { listProfiles, getProfile, currentProfileKey, setCurrentProfile, detectLegacyProfiles, adoptLegacyProfiles } from './core/profiles.js';
import { STRINGS } from './ui/strings.js';
import { el, mount } from './ui/dom.js';
import { renderWelcome } from './ui/screens/welcome.js';
import { renderHome } from './ui/screens/home.js';
import { renderModule } from './ui/screens/module.js';
import { renderSessionScreen } from './ui/screens/session.js';
import { renderResults } from './ui/screens/results.js';
import { createEllaModule } from './engines/ella/index.js';
import { createWordRain } from './engines/wordrain/index.js';

const TINTS = { whales: 'var(--m-whales)', nouns: 'var(--m-ella)', states: 'var(--m-states)', water: 'var(--m-archive)', book: 'var(--m-archive)', magnetism: 'var(--m-archive)' };

export async function start({ version = 'dev' } = {}) {
  const root = document.getElementById('app') || document.body.appendChild(el('div', { id: 'app' }));
  const namespace = globalThis.LP_NAMESPACE || '';
  let sync;
  const store = createStore({ namespace, onDirty: k => sync?.markDirty(k), onRemove: k => sync?.remove(k) });
  let errors = null;
  sync = createFamilySync({ store, onError: err => errors?.record(err) });
  errors = createErrorLog({ store, version, page: () => location.hash });
  errors.install();
  const audio = createAudio({ store, clipUrl: name => new URL(`../audio/${name}.mp3`, import.meta.url).href });
  // Preview only: on the first visit this device's learning data is copied into the preview's
  // own namespace (never the family code), so the preview starts with the real profiles.
  if (namespace && !store.has(K.familyProfiles()) && !detectLegacyProfiles(store).length) {
    try { store.copyFromLive(); } catch (err) { errors.record(err); }
  }
  seedLegacySettings(store);
  // Progress from the old app on this device: its children are there at once, nothing to set up.
  const adopt = () => { try { return adoptLegacyProfiles(store).length; } catch (err) { errors.record(err); return 0; } };
  adopt();
  // German only is the standard; 🇮🇹 shows the Italian lines, which are on the page all along (hidden by the style sheet)
  const paintItalian = () => document.documentElement.classList.toggle('it-on', i18n.showItalian);
  const i18n = createI18n({ store, strings: STRINGS, onChange: () => paintItalian() });
  paintItalian();
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
    /** A module is for this child when it names no grades, the profile has none, or the grade is listed. */
    fitsGrade(mod) { const g = ctx.profile?.grade; return !g || !Array.isArray(mod.grades) || !mod.grades.length || mod.grades.includes(g); },
    /** The modules in today's plan and on the tiles: not archived, and for this child's grade. */
    activeModules() { return ctx.modules.filter(m => !m.archive && ctx.fitsGrade(m)); },
    async cardsOf(mod) {
      if (mod.engine !== 'quiz') return mod.cards ? mod.cards(ctx) : [];
      const qs = await content.questions(mod);
      return content.cardsFor(mod, qs, store.get(K.quizSrs(ctx.profile.key), {}) || {}, { cfg: mod.srs });
    },
    async allCards() {
      const lists = await Promise.all(ctx.activeModules().map(m => ctx.cardsOf(m)));
      return lists.flat();
    },
    /**
     * Start a session. Either `cards` (planned here; `grammar` adds Ella's grammar items)
     * or ready-made `items`. `cards` is best a FUNCTION returning the cards (it may be
     * async): "Nochmal" then plans the next round from the records as they are now, not
     * from the list of the round before. `free`: the child picked a module or topic —
     * the old quiz's order, no new-card limits. `after(summary)` may return extras for
     * the results screen.
     */
    async startSession({ cards = null, items = null, module = 'mixed', mode = 'mixed', grammar = false, free = false, label = null, after = null, skipCheck = false }) {
      const today = todayOf();
      // Ella's grammar items and checks belong to a round only when the trainer is this child's module
      const ella = ctx.ella && (module === 'nouns' || ctx.fitsGrade(ctx.ella)) ? ctx.ella : null;
      const config = { cards, items, module, mode, grammar, free, label, after };
      // a Meister-Check that waited too long comes first, with its announcement (old trainer rule)
      if (!skipCheck && cards && ella && (module === 'mixed' || module === 'nouns')) {
        const k = ella.overdueCheck();
        if (k) { ctx.lastHomeConfig = config; ctx.mcFromTraining = true; router.navigate(['ella', 'mc', k]); return; }
      }
      let list = items;
      if (!list) {
        let pool = typeof cards === 'function' ? await cards() : cards;
        if (typeof cards !== 'function') pool = freshRecords(pool);
        const extra = grammar && ella ? ella.extraItems(4) : [];
        const dayRec = store.get(K.planDays(ctx.profile.key), {})?.[today] || null;
        const plan = store.get(K.plan(ctx.profile.key), null);
        const planned = planSession({ cards: pool, today, dayRecord: dayRec, plan, free, cfg: { ...plannerCfg, sessionSize: Math.max(1, plannerCfg.sessionSize - extra.length) } });
        list = planned.cards.map(card => ({ card, question: card.question }));
        for (const it of extra) list.splice(Math.floor(Math.random() * (list.length + 1)), 0, it);
      }
      ctx.lastSessionConfig = { ...config, skipCheck: true };
      ctx.ellaStartMastered = ella ? ella.masteredNow() : 0;
      // concept bookkeeping belongs to the daily training only — a drill or a quiz round never moved a concept (old trainer)
      live.after = after || (ella && grammar ? sum => ella.afterTraining(sum, ctx.ellaStartMastered) : null);
      live.session = createSession({ items: list, profile: ctx.profile.key, store, today, module, mode, label });
      router.navigate(['session']);
    },
  };

  /** A ready-made card list: look every record up again (the list may be a round old). */
  function freshRecords(cards) {
    const stores = {};
    return (cards || []).map(c => {
      const key = STORE_KEY[c.store]?.(ctx.profile.key);
      if (!key) return c;
      const all = stores[key] || (stores[key] = store.get(key, {}) || {});
      return { ...c, rec: all[c.id] };
    });
  }

  async function loadModules() {
    const index = await content.index();
    const out = [];
    for (const m of index) {
      // one missing or broken module must not keep the child from the others
      try {
        if (m.kind === 'quiz') {
          const mod = await content.module(m.id);
          if (!mod) continue;
          const count = (await content.questions(mod)).length;
          out.push({ ...mod, srs: srsConfig(mod.srs || {}), count, tint: TINTS[m.id] || 'var(--card-tint)' });
        } else if (m.kind === 'pack' && m.id === 'nouns') {
          const data = await content.nounPack(m.id);
          if (data) out.push(createEllaModule(ctx, data));
        }
      } catch (err) { errors.record(new Error(`Modul "${m.id}" konnte nicht geladen werden: ${err?.message || err}`)); }
    }
    if (!out.length) throw new Error('Kein Modul konnte geladen werden.');
    ctx.modules = out;
    const ella = ctx.ella;
    if (ella) { const game = createWordRain(ctx, [...ella.byDe.values()]); ctx.games.wordrain = root => game.render(root); }
  }

  // An old link or bookmark names the child (?profil=…): it wins over the profile this device
  // remembers, once, and is then taken out of the address. With two or more profiles and no
  // such link, a fresh page starts at "Wer lernt heute?" — on a shared tablet the last child
  // must not silently become the next one (wrong answers lower her boxes for good).
  const linked = profileFromSearch(location.search);
  if (linked && getProfile(store, linked)) {
    setCurrentProfile(store, linked);
    try { const u = new URL(location.href); u.searchParams.delete('profil'); history.replaceState(null, '', u.pathname + u.search + u.hash); } catch {}
  }
  let mustPick = !(linked && getProfile(store, linked)) && listProfiles(store).length > 1;
  ctx.profileChosen = () => { mustPick = false; };

  function requireProfile() {
    const key = mustPick ? null : currentProfileKey(store);
    const p = key ? getProfile(store, key) : null;
    if (p) { ctx.profile = p; return true; }
    return false;
  }

  const screens = {
    async welcome() { ctx.profile = null; const form = router.current.params.form ? pending.form : null; pending.form = null; renderWelcome(root, ctx, { form }); },
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
      catch (err) { errors.record(err); failScreen(err); }
    },
  });
  ctx.router = router;

  /** Something could not be shown: say so, and offer the two ways out. */
  function failScreen(err) {
    mount(root, el('div', { class: 'col' }, el('div', { class: 'notice' }, i18n.t('error.content'), ' ', String(err?.message || err)),
      el('div', { class: 'row' }, el('button', { class: 'btn primary', type: 'button', onClick: () => location.reload() }, 'Nochmal versuchen'),
        ctx.modules.length ? el('button', { class: 'btn', type: 'button', onClick: () => router.navigate(['home']) }, 'Zur Startseite') : null)));
  }

  // The sync starts before the content loads: the family link is taken out of the address
  // and the pull runs even if a content file is missing.
  let started = false;
  window.addEventListener('familysync-pulled', () => {
    adopt();   // progress that arrived for a child this family has no profile for yet
    if (!started) return;
    const [name] = router.current.path;
    const onPicker = !['home', 'module', 'ella', 'game', 'session', 'results', 'eltern'].includes(name);
    // the picker shows the family's profiles as soon as they arrive — but never under a form someone is filling in
    if (name === 'home' || name === 'module' || (onPicker && !root.querySelector('.form'))) router.navigate(router.current.path, router.current.params, { replace: true });
  });
  sync.init();

  try { await loadModules(); }
  catch (err) { errors.record(err); failScreen(err); return; }

  // iOS only lets a page play sound after a real tap; keep trying on every tap until it worked
  const unlock = () => { audio.unlock(); if (audio.unlocked) for (const ev of ['pointerup', 'touchend', 'click']) document.removeEventListener(ev, unlock, true); };
  for (const ev of ['pointerup', 'touchend', 'click']) document.addEventListener(ev, unlock, { capture: true, passive: true });

  // A tab that stays open for days: when it comes back and a newer version is online, reload — never during a round.
  let lastVersionCheck = Date.now();
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || Date.now() - lastVersionCheck < 10 * 60 * 1000) return;
    lastVersionCheck = Date.now();
    try {
      const res = await fetch(new URL('../version.json', import.meta.url), { cache: 'no-store' });
      if (!res.ok) return;
      const online = (await res.json())?.version;
      if (typeof online === 'string' && version !== 'dev' && online !== version && !live.session && router.current.path[0] !== 'session') location.reload();
    } catch {}
  });

  started = true;
  router.start();
  return ctx;
}
