// Deutsch mit Ella — the module: noun cards for the planner, grammar items
// for a session, the Lernpfad / Meister-Check / drill sessions, badges, and
// its own screens (home, lesson, check intro, Wörter-Zoo, Schatzkiste).
import { keys as K } from '../../core/storage.js';
import { config as srsConfig, summarize } from '../../core/srs.js';
import { streak, goalReached } from '../../core/planner.js';
import { today as todayOf, addDays } from '../../core/time.js';
import { el, mount, lessonHtml } from '../../ui/dom.js';
import { horizon } from '../../ui/horizon.js';
import { practisedDays } from '../../ui/screens/home.js';
import { isTrap, masteredCount, buckets, UNLOCK_AKK, MASTERED_BOX } from './rules.js';
import { createConcepts, CONCEPTS, CONCEPT_KEYS, FEST_MIN_DAYS, MC_SIZE, MC_RETRY_DAYS } from './concepts.js';
import { BADGES, checkBadges } from './badges.js';
import { genderQuestion, caseQuestion, nomenQuestion, pathQuestion, newPriority, shuffle } from './items.js';

const TXT = {
  name: { de: 'Deutsch mit Ella', it: 'Tedesco con Ella' },
  motto: { de: 'Blau ist DER, rot ist DIE, grün ist DAS!', it: 'Blu è DER, rosso è DIE, verde è DAS!' },
  training: { de: 'Tägliches Training', it: 'Allenamento di oggi' },
  mastered: { de: 'Gemeisterte Wörter', it: 'Parole imparate' },
  streak: { de: 'Tage in Folge', it: 'Giorni di fila' },
  paths: { de: 'Lernpfade', it: 'Percorsi' },
  drills: { de: 'Sätze üben', it: 'Esercizi con frasi' },
  zoo: { de: 'Wörter-Zoo', it: 'Zoo delle parole' },
  chest: { de: 'Schatzkiste', it: 'Scrigno' },
  step: { de: 'Schritt {n} von {total}', it: 'Passo {n} di {total}' },
  go: { de: 'Los!', it: 'Via!' },
  mc: { de: 'Meister-Check', it: 'Prova da maestro' },
  mcIntro: { de: 'Du hast {name} schon an {d} Tagen trainiert — du bist bereit! {n} Fragen, nur der erste Versuch zählt.', it: 'Hai già allenato {name} per {d} giorni: sei pronta! {n} domande, conta solo il primo tentativo.' },
  festLine: { de: '{name}-Training: Tag {d} von {total} — dann kommt der Meister-Check!', it: 'Allenamento {name}: giorno {d} di {total}, poi la prova da maestro!' },
  goldLine: { de: '{name} — GEMEISTERT!', it: '{name}: padroneggiato!' },
  lockedReq: { de: '{name}: erst {req} meistern', it: '{name}: prima padroneggia {req}' },
  lockedWords: { de: 'Lernpfad Akkusativ: noch {n} Wörter', it: 'Percorso accusativo: ancora {n} parole' },
  ready: { de: 'Lernpfad {name}: bereit zum Start!', it: 'Percorso {name}: pronto!' },
  inProgress: { de: 'Lernpfad {name}: Schritt {n} von {total}', it: 'Percorso {name}: passo {n} di {total}' },
  zooHint: { de: 'Schon {m} von {n} gesammelt! Tippe eine Figur an — sie spricht!', it: 'Già {m} su {n} raccolte! Tocca una figura: parla!' },
  zooEmpty: { de: 'Meistere Wörter im Training, um deinen Zoo zu füllen!', it: 'Impara parole nell\'allenamento per riempire il tuo zoo!' },
  chestTitle: { de: 'Dein Wörter-Schatz ({n} Wörter)', it: 'Il tuo tesoro di parole ({n} parole)' },
  growth: { de: 'Dein Wörter-Berg wächst!', it: 'La tua montagna di parole cresce!' },
  badges: { de: 'Meine Abzeichen', it: 'I miei distintivi' },
  next: { de: 'Nächste Abenteuer', it: 'Prossime avventure' },
  traps: { de: 'Achtung, Fallen-Wörter!', it: 'Attenzione, parole trappola!' },
  trapsNone: { de: 'Keine Fallen-Wörter offen — stark!', it: 'Nessuna parola trappola aperta: forte!' },
  newBadge: { de: 'Neues Abzeichen: {em} {lbl}!', it: 'Nuovo distintivo: {em} {lbl}!' },
  stepDone: { de: 'Schritt {n} geschafft!', it: 'Passo {n} superato!' },
  detective: { de: 'Du bist {d}!', it: 'Sei {d}!' },
  stepAgain: { de: 'Gut geübt! Diesen Schritt schauen wir uns einfach nochmal an.', it: 'Ben allenato! Rivediamo questo passo un\'altra volta.' },
  mcPassed: { de: '{name} GEMEISTERT!', it: '{name}: padroneggiato!' },
  mcFailed: { de: 'Fast geschafft! Du hattest {c} von {n} — für den Meister-Titel brauchst du {need}. Noch {days} Tage Training, dann klappt es bestimmt!', it: 'Quasi! Avevi {c} su {n}; per il titolo servono {need}. Ancora {days} giorni di allenamento!' },
  unlockedPath: { de: 'Neu freigeschaltet: Lernpfad {name}!', it: 'Sbloccato: percorso {name}!' },
  unlockedDrill: { de: '„Sätze üben ({name})“ ist jetzt frei!', it: '„Esercizi con frasi ({name})“ è ora aperto!' },
  festStart: { de: 'Jetzt kommt das Training: Deine täglichen Runden enthalten {name}-Fragen. Nach {d} Übungstagen wartet der Meister-Check!', it: 'Ora l\'allenamento: i tuoi giri quotidiani contengono domande su {name}. Dopo {d} giorni ti aspetta la prova da maestro!' },
  mcWaiting: { de: 'Der Meister-Check ({name}) wartet auf dich!', it: 'La prova da maestro ({name}) ti aspetta!' },
  pathWaiting: { de: 'Ein neuer Schritt im Lernpfad {name} wartet auf dich!', it: 'Un nuovo passo del percorso {name} ti aspetta!' },
  unlockAkk: { de: 'Neu freigeschaltet: Lernpfad Akkusativ — entdecke das Geheimnis der Ziele!', it: 'Sbloccato: percorso accusativo!' },
  toTraining: { de: 'Weiter zum Training', it: 'Avanti con l\'allenamento' },
  stepPick: { de: 'Schritt', it: 'Passo' },
  back: { de: 'Zurück', it: 'Indietro' },
  bucket: { gemeistert: { de: 'Gemeistert', it: 'conquistate' }, fast: { de: 'Fast sicher', it: 'quasi sicure' }, lernen: { de: 'Am Lernen', it: 'in corso' }, neu: { de: 'Noch neu', it: 'ancora nuove' } },
};
const fmt = (s, p = {}) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in p ? p[k] : m));

export function createEllaModule(ctx, data) {
  const { nouns, categories, templates, paths, wortbau } = data;
  const cfg = srsConfig(data.pack.srs || {});
  const byDe = new Map(nouns.map(n => [n.de, n]));
  const prio = newPriority(nouns);
  const recent = [];
  const { store, i18n, audio } = ctx;
  const profile = () => ctx.profile.key;
  const srsOf = () => store.get(K.gramSrs(profile()), {}) || {};
  const concepts = () => createConcepts({ store, profile: profile(), units: paths, today: () => todayOf() });
  const t = (key, p) => { const v = TXT[key]; return { de: fmt(v.de, p), it: i18n.showItalian ? fmt(v.it, p) : null }; };
  const line = (key, p, cls = 'soft') => { const v = t(key, p); const n = el('div', { class: cls }, v.de); if (v.it) n.appendChild(el('span', { class: 'it' }, v.it)); return n; };

  // ── cards and items for sessions ───────────────────────────────────
  function cards() {
    const srs = srsOf();
    return nouns.map(n => ({
      id: n.de, module: 'nouns', topic: 'gender', store: 'gramSrs', cfg, rec: srs[n.de], tags: ['nouns'],
      newPriority: prio.get(n.de), question: genderQuestion(n, srs[n.de]),
    }));
  }

  function caseCard(k, q) {
    if (!q) return null;
    const card = { id: `ella:${k}:${Math.random().toString(36).slice(2, 8)}`, module: 'nouns', topic: k, store: null, cfg, tags: ['grammar'], concept: k, rec: undefined };
    if (q.type === 'case') {
      let errType = null;
      card.onAnswer = ({ ok, attempt, response, final }) => {
        if (attempt === 1 && !ok) errType = q.hintFor ? diagnose(q, response) : 'both';
        if (final) recordCase(k, ok && attempt === 1 ? { c: 1 } : { errType: errType || 'both' });
      };
    }
    return { card, question: q };
  }
  function diagnose(q, choice) { return q.hintFor ? (q.hintFor(choice).de.startsWith('Denk dran') ? 'gender' : q.hintFor(choice).de.startsWith('Es heißt') ? 'both' : 'case') : 'both'; }
  function recordCase(k, { c = 0, errType = null }) {
    const key = K.gramCase(profile());
    const all = store.get(key, {}) || {};
    const s = all[k] || (all[k] = { a: 0, c: 0, gErr: 0, cErr: 0, bothErr: 0 });
    s.a++; s.c += c;
    if (errType === 'gender') s.gErr++; else if (errType === 'case') s.cErr++; else if (errType === 'both') s.bothErr++;
    store.set(key, all);
  }
  function live(k, minBox = 2) {
    const srs = srsOf();
    if (CONCEPTS[k].live === 'nomen') return nomenQuestion({ nouns, srs, wortbau, recent, minBox });
    return caseQuestion({ kase: k, nouns, srs, templates, minBox });
  }
  function conceptItem(k) {
    const pool = (paths[k] || []).flatMap(u => u.items || []);
    return pool.length ? pathQuestion(pool[Math.floor(Math.random() * pool.length)]) : null;
  }

  /** Up to four grammar items for a training session, with the old priorities. */
  function extraItems(max = 4) {
    const c = concepts();
    const out = [];
    const push = (k, q) => { const it = caseCard(k, q); if (it && out.length < max) out.push(it); };
    const festKs = CONCEPT_KEYS.filter(k => c.inFest(k)).slice(0, 2);
    if (festKs.length === 1) { const k = festKs[0]; push(k, live(k, 3)); push(k, live(k, 3)); push(k, conceptItem(k)); }
    else if (festKs.length === 2) for (const k of festKs) { push(k, live(k, 3)); push(k, conceptItem(k)); }
    for (const k of CONCEPT_KEYS.filter(k => c.due(k)).slice(0, 1)) { push(k, live(k, 2)); push(k, conceptItem(k)); }
    const goldKs = CONCEPT_KEYS.filter(k => c.gold(k) && !c.due(k));
    while (out.length < max && goldKs.length) { const q = live(goldKs[Math.floor(Math.random() * goldKs.length)], 2); if (!q) break; push(goldKs[0], q); }
    if (!festKs.length && out.length < max && Math.random() < 0.6) {
      const progK = CONCEPT_KEYS.find(k => !c.done(k) && Object.keys(c.state(k).passed || {}).length);
      if (progK) {
        const passed = Object.keys(c.state(progK).passed).map(Number);
        const pool = (paths[progK] || []).filter(u => passed.includes(u.n)).flatMap(u => u.items || []);
        if (pool.length) push(progK, pathQuestion(pool[Math.floor(Math.random() * pool.length)]));
      }
    }
    return out;
  }

  function summary() {
    const s = summarize(srsOf(), todayOf(), cfg);
    return { total: nouns.length, mastered: s.mastered, due: s.due };
  }

  // ── after a session: concept bookkeeping, badges, notes ────────────
  function facts(sum) {
    const srs = srsOf();
    const c = concepts();
    const today = todayOf();
    const days = store.get(K.planDays(profile()), {}) || {};
    return {
      m: masteredCount(srs), streak: streak(practisedDays(store, profile()), today),
      goalToday: goalReached(days[today], ctx.plannerCfg),
      traps: nouns.filter(n => isTrap(n) && srs[n.de] && srs[n.de].b >= MASTERED_BOX).length,
      pathAkkDone: c.done('akk'), pathDatDone: c.done('dat'), pathNomDone: c.done('nomen'),
      mcAkk: c.gold('akk'), mcDat: c.gold('dat'), mcNom: c.gold('nomen'),
    };
  }
  function awardBadges(extra = {}) {
    const key = K.gramBadges(profile());
    const { fresh, earned } = checkBadges(store.get(key, {}) || {}, facts(), extra, todayOf());
    if (fresh.length) store.set(key, earned);
    return fresh;
  }
  function badgeNotes(fresh) { return fresh.map(b => ({ kind: 'badge', text: t('newBadge', { em: b.em, lbl: b.lbl }) })); }

  /** Ordinary training / mixed session with Ella items in it. */
  function afterTraining(sum, startMastered) {
    const c = concepts();
    const touched = {};
    for (const r of sum.results) if (r.concept && !r.rehearsal) (touched[r.concept] = touched[r.concept] || []).push(r.outcome);
    c.afterSession(touched);
    const perfect = sum.firstTry === sum.total && sum.total >= 8;
    const notes = badgeNotes(awardBadges({ perfect }));
    const m = masteredCount(srsOf());
    const mcK = CONCEPT_KEYS.find(k => c.mcReady(k));
    const festK = CONCEPT_KEYS.find(k => c.inFest(k));
    if (mcK) notes.push({ kind: 'info', text: t('mcWaiting', { name: CONCEPTS[mcK].name }) });
    else if (festK && c.festDays(festK) < FEST_MIN_DAYS) notes.push({ kind: 'info', text: t('festLine', { name: CONCEPTS[festK].name, d: c.festDays(festK), total: FEST_MIN_DAYS }) });
    for (const k of CONCEPT_KEYS.filter(k => c.pathOpen(k) && !c.done(k) && (k !== 'akk' || m >= UNLOCK_AKK))) {
      if (Object.keys(c.state(k).passed || {}).length < (paths[k] || []).length) notes.push({ kind: 'info', text: t('pathWaiting', { name: CONCEPTS[k].name }) });
    }
    if (startMastered < UNLOCK_AKK && m >= UNLOCK_AKK) notes.push({ kind: 'unlock', text: t('unlockAkk') });
    return { notes };
  }

  // ── special sessions ──────────────────────────────────────────────
  function startTraining() {
    ctx.startSession({ cards: cards(), module: 'nouns', mode: 'training', grammar: true });
  }
  function startDrill(k) {
    const items = [];
    for (let i = 0; i < 10; i++) { const it = caseCard(k, live(k, 2)); if (it) items.push(it); }
    ctx.startSession({ items, module: 'nouns', mode: `drill-${k}`, label: `${TXT.drills.de} · ${CONCEPTS[k].name}` });
  }
  function startPathCheck(k, unitN) {
    const units = paths[k] || [];
    const unit = units[unitN - 1];
    let items;
    if (unit.n === units.length) {
      items = [];
      for (let i = 0; i < 6; i++) { const it = caseCard(k, live(k, 2)); if (it) items.push(it); }
      if (items.length < 4) items = items.concat([...(units[2]?.items || []), ...(units[3]?.items || [])].map(it => caseCard(k, pathQuestion(it)))).slice(0, 6);
    } else items = shuffle((unit.items || []).map(it => caseCard(k, pathQuestion(it))));
    ctx.startSession({
      items, module: 'nouns', mode: `path-${k}`, label: `${CONCEPTS[k].name} · ${fmt(TXT.step.de, { n: unitN, total: units.length })}`,
      after: sum => {
        const c = concepts();
        const wrong = sum.results.filter(r => !r.rehearsal && r.outcome === 'wrong').length;
        const retries = sum.results.filter(r => !r.rehearsal && r.outcome === 'retry').length;
        const { passed, nowDone } = c.recordPath(k, unitN, { wrong, retries });
        const con = CONCEPTS[k];
        const notes = [];
        let title;
        if (passed && nowDone) {
          title = t('detective', { d: con.detective });
          notes.push(...badgeNotes(awardBadges()));
          if (con.drill) notes.push({ kind: 'unlock', text: t('unlockedDrill', { name: con.name }) });
          notes.push({ kind: 'info', text: t('festStart', { name: con.name, d: FEST_MIN_DAYS }) });
        } else if (passed) {
          title = t('stepDone', { n: unitN });
        } else {
          title = t('stepAgain');
        }
        return { title, notes, again: { label: passed && !nowDone ? fmt(TXT.step.de, { n: unitN + 1, total: units.length }) : TXT.go.de, run: () => ctx.router.navigate(['ella', 'lesson', k]) } };
      },
    });
  }
  function startMc(k, fromTraining = false) {
    const items = [];
    for (let i = 0; i < 6; i++) { const it = caseCard(k, live(k, 4)); if (it) items.push(it); }
    const pool = shuffle((paths[k] || []).flatMap(u => u.items || []));
    for (const it of pool.slice(0, Math.max(0, MC_SIZE - items.length))) items.push(caseCard(k, pathQuestion(it)));
    ctx.startSession({
      items: shuffle(items), module: 'nouns', mode: `mc-${k}`, label: `${TXT.mc.de} · ${CONCEPTS[k].name}`,
      after: sum => {
        const c = concepts();
        const { passed, need } = c.recordMc(k, sum.firstTry, sum.total);
        const con = CONCEPTS[k];
        const notes = [];
        let title;
        if (passed) {
          title = t('mcPassed', { name: con.name });
          notes.push(...badgeNotes(awardBadges()));
          if (con.next && !c.done(con.next)) notes.push({ kind: 'unlock', text: t('unlockedPath', { name: CONCEPTS[con.next].name }) });
        } else {
          title = t('mcFailed', { c: sum.firstTry, n: sum.total, need, days: MC_RETRY_DAYS });
        }
        return { title, notes, again: { label: TXT.toTraining.de, run: () => (fromTraining ? ctx.startSession(ctx.lastHomeConfig || { cards: cards(), module: 'nouns', mode: 'training', grammar: true }) : startTraining()) } };
      },
    });
  }
  /** A Meister-Check that has waited too long comes first; returns its concept key or null. */
  function overdueCheck() { const c = concepts(); return CONCEPT_KEYS.find(k => c.mcOverdue(k)) || null; }

  // ── screens ───────────────────────────────────────────────────────
  const stage = col => el('div', { class: 'stage' }, horizon(), col);
  const topbar = (title, back = () => ctx.go('home')) => el('div', { class: 'topbar' }, el('button', { class: 'icon-btn', type: 'button', 'aria-label': TXT.back.de, onClick: back }, '←'),
    el('div', { class: 'greet' }, el('span', { class: 'disc' }, '🦉'), el('div', {}, el('h1', {}, title.de), title.it && i18n.showItalian ? el('div', { class: 'it' }, title.it) : null)));

  function renderHome(root) {
    const c = concepts();
    const srs = srsOf();
    const m = masteredCount(srs);
    const n = streak(practisedDays(store, profile()), todayOf());
    const col = el('div', { class: 'col enter' });
    col.appendChild(topbar(TXT.name));
    col.appendChild(el('div', { class: 'chip', style: { alignSelf: 'center' } }, TXT.motto.de));
    col.appendChild(el('div', { class: 'facts' }, fact(n, t('streak').de, '🔥'), fact(m, t('mastered').de, '💎'), fact(nouns.length - m, 'noch zu lernen', '📦')));
    const mcK = CONCEPT_KEYS.find(k => c.mcReady(k));
    const actions = el('div', { class: 'stack' });
    actions.appendChild(el('button', { class: 'btn primary', type: 'button', style: { width: '100%' }, onClick: startTraining }, `🎯 ${TXT.training.de}`));
    if (mcK) actions.appendChild(el('button', { class: `btn${c.mcOverdue(mcK) ? ' primary' : ''}`, type: 'button', style: { width: '100%' }, onClick: () => ctx.router.navigate(['ella', 'mc', mcK]) }, `🏆 ${TXT.mc.de} ${CONCEPTS[mcK].name}`));
    col.appendChild(el('section', { class: 'card' }, actions));

    const pathsCard = el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, TXT.paths.de));
    for (const k of CONCEPT_KEYS) {
      const con = CONCEPTS[k], st = c.state(k), units = paths[k] || [];
      let text, button = null;
      if (c.gold(k)) text = t('goldLine', { name: con.name });
      else if (c.inFest(k)) text = t('festLine', { name: con.name, d: c.festDays(k), total: FEST_MIN_DAYS });
      else if (!c.pathOpen(k)) text = t('lockedReq', { name: con.name, req: CONCEPTS[con.requires].name });
      else if (k === 'akk' && m < UNLOCK_AKK) text = t('lockedWords', { n: UNLOCK_AKK - m });
      else {
        const started = Object.keys(st.passed || {}).length > 0;
        text = started ? t('inProgress', { name: con.name, n: c.nextUnit(k), total: units.length }) : t('ready', { name: con.name });
        button = el('button', { class: 'btn small', type: 'button', onClick: () => ctx.router.navigate(['ella', 'lesson', k]) }, `🎓 ${fmt(TXT.step.de, { n: c.nextUnit(k), total: units.length })}`);
      }
      if (c.gold(k) || c.inFest(k)) button = el('button', { class: 'btn small ghost', type: 'button', onClick: () => ctx.router.navigate(['ella', 'lesson', k]) }, '🎓 Wiederholen');
      const row = el('div', { class: 'row spread' }, el('div', {}, el('div', { style: { fontWeight: '800' } }, `${con.em} ${text.de}`), text.it ? el('span', { class: 'it' }, text.it) : null), button);
      pathsCard.appendChild(row);
    }
    col.appendChild(pathsCard);

    const drills = CONCEPT_KEYS.filter(k => CONCEPTS[k].drill && c.done(k));
    if (drills.length) col.appendChild(el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, TXT.drills.de),
      el('div', { class: 'row' }, ...drills.map(k => el('button', { class: 'btn', type: 'button', onClick: () => startDrill(k) }, `${CONCEPTS[k].em} ${CONCEPTS[k].name}`)))));
    col.appendChild(el('div', { class: 'row' }, el('button', { class: 'btn', type: 'button', onClick: () => ctx.router.navigate(['ella', 'zoo']) }, `🦁 ${TXT.zoo.de}`), el('button', { class: 'btn', type: 'button', onClick: () => ctx.router.navigate(['ella', 'progress']) }, `💎 ${TXT.chest.de}`)));
    mount(root, stage(col));
  }
  const fact = (v, l, em) => el('div', { class: 'fact' }, el('span', { class: 'v' }, String(v)), el('span', { class: 'l' }, `${em} ${l}`));

  function renderLesson(root, k, unitOverride) {
    const c = concepts();
    const units = paths[k] || [];
    if (!units.length) { ctx.router.navigate(['module', 'nouns']); return; }
    const unitN = unitOverride || c.nextUnit(k);
    const unit = units[unitN - 1];
    const col = el('div', { class: 'col enter' });
    col.appendChild(topbar({ de: `${CONCEPTS[k].em} ${CONCEPTS[k].name}` }, () => ctx.router.navigate(['module', 'nouns'])));
    const dots = el('div', { class: 'segments' }, ...units.map((u, i) => el('i', { class: c.state(k).passed?.[u.n] ? 'done' : (i === unitN - 1 ? 'now' : '') })));
    const card = el('section', { class: 'card stack' }, el('span', { class: 'eyebrow' }, fmt(TXT.step.de, { n: unitN, total: units.length })), el('h2', {}, unit.title), dots, lessonHtml(unit.lessonHtml));
    if (c.done(k)) card.appendChild(el('div', { class: 'tabs' }, ...units.map(u => el('button', { type: 'button', class: u.n === unitN ? 'on' : '', onClick: () => renderLesson(root, k, u.n) }, `${TXT.stepPick.de} ${u.n}`))));
    card.appendChild(el('button', { class: 'btn primary', type: 'button', style: { width: '100%' }, onClick: () => startPathCheck(k, unitN) }, TXT.go.de));
    col.appendChild(card);
    mount(root, stage(col));
    if (!i18n.showItalian) col.querySelectorAll('.lesson .it').forEach(n => { n.hidden = true; });
  }

  function renderMcIntro(root, k) {
    const c = concepts();
    if (!c.mcReady(k)) { ctx.router.navigate(['module', 'nouns']); return; }
    const col = el('div', { class: 'col enter' });
    col.appendChild(topbar({ de: `🏆 ${TXT.mc.de}: ${CONCEPTS[k].name}` }, () => ctx.router.navigate(['module', 'nouns'])));
    col.appendChild(el('section', { class: 'card stack' }, line('mcIntro', { name: CONCEPTS[k].name, d: c.festDays(k), n: MC_SIZE }, 'hint-text'),
      el('button', { class: 'btn primary', type: 'button', style: { width: '100%' }, onClick: () => startMc(k, false) }, TXT.go.de)));
    mount(root, stage(col));
  }

  function renderZoo(root) {
    const srs = srsOf();
    const col = el('div', { class: 'col enter' });
    col.appendChild(topbar({ de: `🦁 ${TXT.zoo.de}` }, () => ctx.router.navigate(['module', 'nouns'])));
    let totalM = 0;
    const won = n => srs[n.de] && srs[n.de].b >= MASTERED_BOX;
    const name = el('div', { class: 'card', style: { textAlign: 'center', fontWeight: '800' } });
    col.appendChild(name);
    for (const [cat, meta] of Object.entries(categories)) {
      const list = nouns.filter(n => n.cat === cat);
      if (!list.length) continue;
      const w = list.filter(won).length; totalM += w;
      const grid = el('div', { class: 'zoo-grid' });
      for (const n of list) grid.appendChild(won(n)
        ? el('button', { class: 'zoo-chip', type: 'button', 'aria-label': `${n.g} ${n.de}`, onClick: () => { name.textContent = `${n.em} ${n.g} ${n.de}${n.pl ? ` · die ${n.pl}` : ''}`; audio.speak({ clip: `a_${audio.slug(n.de)}`, text: `${n.g} ${n.de}` }); } }, n.em)
        : el('span', { class: 'zoo-chip locked' }, '❓'));
      col.appendChild(el('section', { class: 'card stack' }, el('div', { class: 'row spread' }, el('h2', {}, `${meta.icon || ''} ${meta.label.de}`), el('span', { class: 'chip' }, `${w}/${list.length}`)), grid));
    }
    name.textContent = totalM ? t('zooHint', { m: totalM, n: nouns.length }).de : TXT.zooEmpty.de;
    mount(root, stage(col));
  }

  function renderProgress(root) {
    const srs = srsOf();
    const c = concepts();
    const days = store.get(K.gramDays(profile()), {}) || {};
    const col = el('div', { class: 'col enter' });
    col.appendChild(topbar({ de: `💎 ${TXT.chest.de}` }, () => ctx.router.navigate(['module', 'nouns'])));
    const b = buckets(nouns, srs);
    const chest = el('section', { class: 'card stack' }, el('h2', {}, t('chestTitle', { n: nouns.length }).de));
    for (const [key, color] of [['gemeistert', 'var(--ok)'], ['fast', 'var(--streak)'], ['lernen', 'var(--accent)'], ['neu', 'var(--line)']]) {
      chest.appendChild(el('div', { class: 'row' }, el('span', { style: { width: '9em', fontWeight: '800' } }, TXT.bucket[key].de),
        el('div', { style: { flex: '1', height: '14px', background: 'var(--card-tint)', borderRadius: '7px', overflow: 'hidden' } }, el('div', { style: { width: `${b[key] / nouns.length * 100}%`, height: '100%', background: color } })),
        el('span', { class: 'num', style: { width: '3em', textAlign: 'right', fontWeight: '800' } }, String(b[key]))));
    }
    col.appendChild(chest);
    // 14-day mastered chart
    const today = todayOf();
    let carry = 0;
    for (const ds of Object.keys(days).sort()) if (ds < addDays(today, -13) && days[ds]?.m != null) carry = days[ds].m;
    const pts = [];
    for (let i = 13; i >= 0; i--) { const ds = addDays(today, -i); if (days[ds]?.m != null) carry = days[ds].m; pts.push({ ds, m: carry }); }
    const maxM = Math.max(10, ...pts.map(p => p.m));
    col.appendChild(el('section', { class: 'card stack' }, el('h2', {}, `📈 ${TXT.growth.de}`),
      el('div', { style: { display: 'flex', gap: '4px', alignItems: 'flex-end', height: '90px' } }, ...pts.map((p, i) => el('div', { title: `${p.ds}: ${p.m}`, style: { flex: '1', height: `${Math.max(3, p.m / maxM * 100)}%`, background: i === pts.length - 1 ? 'var(--accent)' : 'var(--lake-2)', borderRadius: '4px 4px 0 0' } }))),
      el('div', { class: 'row spread muted', style: { fontSize: '12px', fontWeight: '800' } }, el('span', {}, pts[0].ds.slice(8) + '.' + pts[0].ds.slice(5, 7) + '.'), el('span', {}, `heute: ${pts.at(-1).m}`))));
    // badges
    const earned = store.get(K.gramBadges(profile()), {}) || {};
    col.appendChild(el('section', { class: 'card stack' }, el('h2', {}, `🏅 ${TXT.badges.de} (${Object.keys(earned).length}/${BADGES.length})`),
      el('div', { class: 'badge-grid' }, ...BADGES.map(bd => el('div', { class: `badge${earned[bd.id] ? '' : ' locked'}`, title: bd.lbl }, el('span', { class: 'b-em' }, bd.em), el('span', { class: 'b-lbl' }, bd.lbl))))));
    // next adventures
    const m = masteredCount(srs);
    const adv = el('section', { class: 'card stack' }, el('h2', {}, `🔓 ${TXT.next.de}`));
    for (const k of CONCEPT_KEYS) {
      const con = CONCEPTS[k], st = c.state(k), units = paths[k] || [];
      let text;
      if (c.gold(k)) text = `🏆 ${fmt(TXT.goldLine.de, { name: con.name })}`;
      else if (c.inFest(k)) text = `🔨 ${fmt(TXT.festLine.de, { name: con.name, d: c.festDays(k), total: FEST_MIN_DAYS })}`;
      else if (Object.keys(st.passed || {}).length) text = `🎓 ${fmt(TXT.inProgress.de, { name: con.name, n: c.nextUnit(k), total: units.length })}`;
      else if (!c.pathOpen(k)) text = `🔒 ${fmt(TXT.lockedReq.de, { name: con.name, req: CONCEPTS[con.requires].name })}`;
      else if (k === 'akk' && m < UNLOCK_AKK) text = `🔒 ${fmt(TXT.lockedWords.de, { n: UNLOCK_AKK - m })}`;
      else text = `🎓 ${fmt(TXT.ready.de, { name: con.name })}`;
      adv.appendChild(el('div', { style: { fontWeight: '700' } }, text));
    }
    col.appendChild(adv);
    // wobbly traps
    const wobbly = nouns.filter(n => { const e = srs[n.de]; return e && e.w > 0 && e.b < MASTERED_BOX && isTrap(n); }).slice(0, 12);
    col.appendChild(el('section', { class: 'card stack' }, el('h2', {}, wobbly.length ? `🇮🇹→🇩🇪 ${TXT.traps.de}` : `🦉 ${TXT.trapsNone.de}`),
      wobbly.length ? el('div', { class: 'row' }, ...wobbly.map(n => el('span', { class: 'chip' }, `${n.g} ${n.de}${n.it ? ` · ${n.it}` : ''}`))) : null));
    mount(root, stage(col));
  }

  function route(root, sub, id) {
    if (sub === 'lesson' && id) return renderLesson(root, id);
    if (sub === 'mc' && id) return renderMcIntro(root, id);
    if (sub === 'zoo') return renderZoo(root);
    if (sub === 'progress') return renderProgress(root);
    return renderHome(root);
  }

  return {
    id: 'nouns', engine: 'ella', name: TXT.name, icon: '🦉', archive: false, tint: 'var(--m-ella)', mascot: { key: 'ella', name: 'Ella' },
    topics: [{ id: 'gender', label: { de: 'Wörter' } }, ...CONCEPT_KEYS.map(k => ({ id: k, label: { de: CONCEPTS[k].name } }))],
    srs: cfg, count: nouns.length, byDe,
    cards, extraItems, summary, afterTraining, overdueCheck, startTraining, startMc,
    renderHome: root => renderHome(root), route: (root, _ctx, sub, id) => route(root, sub, id),
    masteredNow: () => masteredCount(srsOf()),
  };
}
