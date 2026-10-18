// Deutsch mit Ella — the grammar rules, ported from the old trainer. Pure.

export const ART = Object.freeze({
  nom: { def: { der: 'der', die: 'die', das: 'das' }, indef: { der: 'ein', die: 'eine', das: 'ein' } },
  akk: { def: { der: 'den', die: 'die', das: 'das' }, indef: { der: 'einen', die: 'eine', das: 'ein' } },
  dat: { def: { der: 'dem', die: 'der', das: 'dem' }, indef: { der: 'einem', die: 'einer', das: 'einem' } },
});
export const OPTIONS_DEF = Object.freeze(['der', 'die', 'das', 'den', 'dem']);
export const OPTIONS_INDEF = Object.freeze(['ein', 'eine', 'einen', 'einer', 'einem']);
export const GENDERS = Object.freeze(['der', 'die', 'das']);

export const CASE_RULES = Object.freeze({
  akk: { de: 'Wen oder was? → Akkusativ. Nur DER wird zu DEN (ein → einen)!', it: 'Chi o che cosa? → Accusativo. Solo DER diventa DEN (ein → einen)!' },
  dat: { de: 'Wem? → Dativ: dem (der), der (die), dem (das) — mit, bei, zu, von, aus wollen immer den Dativ!', it: 'A chi? → Dativo: dem (der), der (die), dem (das) — mit, bei, zu, von, aus vogliono sempre il dativo!' },
});

export const UNLOCK_AKK = 30;   // mastered words needed for the Akkusativ course
export const UNLOCK_DAT = 70;   // … only drives a badge (as in the old app)
export const MASTERED_BOX = 3;

/** A "trap": the Italian gender would mislead. */
export function isTrap(n) {
  return !((n.g === 'der' && n.itG === 'm') || (n.g === 'die' && n.itG === 'f'));
}

/** A rule of thumb for the article, or null. */
export function genderRule(n) {
  const w = n.de;
  if (n.rule === 'monat') return 'Alle Monate sind DER! 📅';
  if (n.rule === 'tag') return 'Alle Wochentage sind DER! 🗓️';
  if (/ung$/.test(w)) return 'Wörter auf -ung sind immer DIE!';
  if (/(heit|keit)$/.test(w)) return 'Wörter auf -heit und -keit sind immer DIE!';
  if (/(chen|lein)$/.test(w)) return 'Wörter auf -chen sind immer DAS — auch das Mädchen!';
  if (/schaft$/.test(w)) return 'Wörter auf -schaft sind immer DIE — ohne Ausnahme!';
  if (/tum$/.test(w)) return (w === 'Reichtum' || w === 'Irrtum')
    ? 'Das Angeber-Paar! DER Reichtum und DER Irrtum sind die einzigen -tum-Wörter mit DER!'
    : 'Wörter auf -tum sind fast immer DAS — nur Reichtum und Irrtum sind DER!';
  if (/nis$/.test(w)) return n.g === 'die' ? `Achtung, Ausnahme! -nis ist meistens DAS — aber es heißt DIE ${w}!` : 'Wörter auf -nis sind meistens DAS!';
  if (/in$/.test(w) && n.cat === 'menschen' && n.g === 'die') return 'Frauen-Wörter auf -in sind DIE!';
  if (['Frühling', 'Sommer', 'Herbst', 'Winter'].includes(w)) return 'Alle Jahreszeiten sind DER! 🍂';
  return null;
}

/** Italian note for a trap word, or null. */
export function trapNote(n) {
  if (!isTrap(n) || !n.it) return null;
  return `Attenzione: in italiano si dice ${n.it} — ma in tedesco è ${n.g} ${n.de}!`;
}

/** Was a wrong article a gender mistake, a case mistake, or both? */
export function diagnoseCase(choice, kase, noun) {
  const hits = [];
  for (const k of ['nom', 'akk', 'dat']) for (const d of ['def', 'indef']) for (const g of GENDERS) if (ART[k][d][g] === choice) hits.push({ k, g });
  const rightGender = hits.some(x => x.g === noun.g);
  const rightCase = hits.some(x => x.k === kase);
  if (!rightGender && rightCase) return 'gender';
  if (rightGender && !rightCase) return 'case';
  return 'both';
}

/** The sentence of a case drill: '%A %N' filled; returns {sentence, solution, nounForm, opts}. */
export function buildCase(tpl, noun, kase, defArt) {
  const solution = ART[kase][defArt][noun.g];
  const nounForm = (kase !== 'nom' && noun.obl) ? noun.obl : noun.de;
  const sentence = tpl.t.replace('%A', '___').replace('%N', nounForm);
  const opts = (defArt === 'def' ? OPTIONS_DEF : OPTIONS_INDEF).slice();
  return { sentence, solution, nounForm, opts };
}

export function masteredCount(srs) {
  return Object.values(srs || {}).filter(e => e && e.b >= MASTERED_BOX).length;
}

/** The parents' view of a word: hilfe | arbeit | fast | sicher | neu */
export function nounStatus(e) {
  if (!e) return 'neu';
  if (e.w >= 3 && e.b <= 1) return 'hilfe';
  if (e.b >= 4) return 'sicher';
  if (e.b === 3) return 'fast';
  return 'arbeit';
}

/** Buckets for the Schatzkiste. */
export function buckets(nouns, srs) {
  const b = { neu: 0, lernen: 0, fast: 0, gemeistert: 0 };
  for (const n of nouns) {
    const e = srs[n.de];
    if (!e) b.neu++; else if (e.b <= 1) b.lernen++; else if (e.b <= 2) b.fast++; else b.gemeistert++;
  }
  return b;
}

export const PRAISE = Object.freeze(['Super! 🎉', 'Genau richtig! ⭐', 'Toll gemacht! 💪', 'Perfekt! 🌟', 'Klasse! 🎊', 'Richtig gut! 🥳']);
