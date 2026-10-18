// Question builders of Deutsch mit Ella. Each returns a question object the
// session screen can render: types gender | case | pmcq | pfill.
import { isTrap, genderRule, trapNote, buildCase, diagnoseCase, CASE_RULES, PRAISE } from './rules.js';

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const isDate = n => n.rule === 'monat' || n.rule === 'tag';

/** Article question for a noun; typed after 3 first-try rights in a row. */
export function genderQuestion(noun, rec, rng = Math.random) {
  const rule = genderRule(noun);
  const trap = trapNote(noun);
  return {
    type: 'gender', noun, typed: !!(rec && rec.k >= 3),
    hint: { de: rule ? `Tipp: ${rule}` : 'Denk kurz nach — du schaffst das!' },
    explain: { de: `${pick(PRAISE, rng)} ${rule ? `💡 ${rule}` : ''}`.trim(), it: trap || undefined },
    wrongExplain: { de: `Es heißt ${noun.g} ${noun.de}. Das üben wir morgen nochmal — dann klappt's! 🦉`, it: trap || undefined },
  };
}

/** A case drill sentence from the templates and the child's known nouns. */
export function caseQuestion({ kase, nouns, srs, templates, minBox = 2, rng = Math.random }) {
  let known = nouns.filter(n => srs[n.de] && srs[n.de].b >= minBox);
  if (known.length < 10) known = nouns.filter(n => srs[n.de] && srs[n.de].b >= 2);
  const pool = known.length >= 10 ? known : nouns.filter(n => srs[n.de]);
  const tpls = templates[kase] || [];
  for (let tries = 0; tries < 40 && tpls.length; tries++) {
    const tpl = pick(tpls, rng);
    const fits = pool.filter(n => (tpl.cats && tpl.cats.includes(n.cat)) || (tpl.only && tpl.only.includes(n.de)) || (tpl.also && tpl.also.includes(n.de)))
      .filter(n => !isDate(n) && n.pl !== undefined);
    if (!fits.length) continue;
    const noun = pick(fits, rng);
    const defArt = rng() < 0.6 ? 'def' : 'indef';
    const built = buildCase(tpl, noun, kase, defArt);
    return {
      type: 'case', kase, noun, defArt, tpl, em: noun.em, ...built,
      sentence_it: tpl.it || null,
      explain: { de: `${pick(PRAISE, rng)} ${built.solution} ${built.nounForm} — genau richtig!` },
      wrongExplain: { de: `Richtig ist: ${built.solution} ${built.nounForm}. ${CASE_RULES[kase].de}`, it: CASE_RULES[kase].it },
      hintFor(choice) {
        const why = diagnoseCase(choice, kase, noun);
        return why === 'gender' ? { de: `Denk dran: Es heißt ${noun.g} ${noun.de}.` }
          : why === 'case' ? { de: CASE_RULES[kase].de, it: CASE_RULES[kase].it }
          : { de: `Es heißt ${noun.g} ${noun.de} — und hier: ${CASE_RULES[kase].de}`, it: CASE_RULES[kase].it };
      },
    };
  }
  return null;
}

/** Lernpfad item (pmcq | pfill) as a question. */
export function pathQuestion(it) {
  return { ...it, type: it.kind, hint: it.hint ? { de: it.hint } : undefined, explain: it.explain ? { de: it.explain } : undefined };
}

/** Nomen-Bausteine: a Wort-Bauen item or a gender question on a -nis/-schaft/-tum noun. */
export function nomenQuestion({ nouns, srs, wortbau, recent, minBox = 2, rng = Math.random }) {
  if (rng() < 0.4 && wortbau.length) {
    const fresh = wortbau.filter(it => !recent.includes(it.t));
    const it = pick(fresh.length ? fresh : wortbau, rng);
    recent.push(it.t); recent.splice(0, Math.max(0, recent.length - 6));
    return pathQuestion(it);
  }
  const all = nouns.filter(n => /(nis|schaft|tum)$/.test(n.de));
  let pool = all.filter(n => srs[n.de] && srs[n.de].b >= minBox);
  if (pool.length < 4) pool = all.filter(n => srs[n.de]);
  if (pool.length < 4) pool = all;
  const freshN = pool.filter(n => !recent.includes(n.de));
  const n = pick(freshN.length ? freshN : pool, rng);
  recent.push(n.de); recent.splice(0, Math.max(0, recent.length - 6));
  return genderQuestion(n, srs[n.de], rng);
}

/** Order new nouns the way the old trainer introduced them: two traps, then one easy word. */
export function newPriority(nouns) {
  const out = new Map();
  let t = 0, s = 0;
  for (const n of nouns) {
    if (isTrap(n)) { out.set(n.de, Math.floor(t / 2) * 3 + (t % 2)); t++; }
    else { out.set(n.de, s * 3 + 2); s++; }
  }
  return out;
}
