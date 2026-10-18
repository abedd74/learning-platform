// Answer checking for every question type — pure, no DOM.
//
//   check(question, response) → { ok, expected }
//
// Responses by type (what the renderers hand over):
//   choice, image, cycle   the chosen option index
//   multi                  array of chosen indexes
//   bool                   true | false
//   text                   the typed string (lenient match unless answer.exact)
//   order                  array of item indexes in the chosen order
//   pairs                  { leftIndex: rightIndex }
//   gender, case, pmcq, pfill (Deutsch mit Ella)   the chosen string

/** The old app's lenient normalisation for typed answers (fitbNorm), kept as is. */
export function normalizeText(s) {
  return String(s ?? '').trim().toLowerCase()
    .replace(/[.,!?;:'"„“”‚‘’]/g, '')
    .replace(/-/g, ' ')
    .replace(/ß/g, 'ss')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
    .replace(/^(der|die|das|den|dem|ein|eine|einen|the|a|an|il|la|lo|l')\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Exact matching for spelling tasks (the states module): trimmed, Unicode-normalised, case kept. */
export function normalizeExact(s) {
  return String(s ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
}

const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && [...a].sort((x, y) => x - y).every((v, i) => v === [...b].sort((x, y) => x - y)[i]);
const sameList = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);

export function check(q, response) {
  const a = q.answer || {};
  switch (q.type) {
    case 'choice':
    case 'image':
    case 'cycle':
      return { ok: Number.isInteger(response) && response === a.correct, expected: a.correct };
    case 'multi':
      return { ok: sameSet(response, a.correct), expected: a.correct };
    case 'bool':
      return { ok: typeof response === 'boolean' && response === a.correct, expected: a.correct };
    case 'text': {
      const norm = a.exact ? normalizeExact : normalizeText;
      const given = norm(response);
      const ok = given !== '' && (a.accepted || []).some(x => norm(x) === given);
      return { ok, expected: a.accepted?.[0] ?? '' };
    }
    case 'order':
      return { ok: sameList(response, a.correct), expected: a.correct };
    case 'pairs': {
      const n = (a.pairs || []).length;
      const ok = !!response && typeof response === 'object' && n > 0 &&
        Array.from({ length: n }, (_, i) => response[i] === i).every(Boolean);
      return { ok, expected: Object.fromEntries(Array.from({ length: n }, (_, i) => [i, i])) };
    }
    // Deutsch mit Ella items carry their solution as a string
    case 'gender': {
      const r = String(response ?? '').trim().toLowerCase();
      return { ok: r === q.noun?.g, expected: q.noun?.g };
    }
    case 'case':
      return { ok: response === q.solution, expected: q.solution };
    case 'pmcq':
    case 'pfill':
      return { ok: response === q.correct, expected: q.correct };
    default:
      return { ok: false, expected: undefined };
  }
}

/** Letter-by-letter difference for the typing tasks: [{ch, ok}] over the expected word. */
export function diffLetters(expected, given) {
  const e = normalizeExact(expected), g = normalizeExact(given);
  const out = [];
  const n = Math.max(e.length, g.length);
  for (let i = 0; i < n; i++) {
    if (i < e.length) out.push({ ch: e[i], ok: g[i] === e[i] });
    else out.push({ ch: g[i], ok: false, extra: true });
  }
  return out;
}
