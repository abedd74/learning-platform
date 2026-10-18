// One-off (phase 2): turn the content of the OLD pages into data files.
//
//   node tools/extract-banks.mjs            writes content/ and assets/figures/
//   node tools/extract-banks.mjs --force    overwrites existing files
//
// Opens index.html and grammatik.html from this checkout in WebKit (empty
// profile, outside requests blocked), reads the question banks exactly as the
// running app holds them — with the ids the app assigned — and writes:
//   content/<module>/module.json + one <topic>.json per topic   (4 quiz modules)
//   content/nouns/{pack,nouns,categories,templates,path-*,wortbau}.json
//   assets/figures/whales/<hash>.svg                            (whale drawings)
//
// Children's names: the old content used a child as the speaker of every
// true/false statement and in a few examples. Those become the module's
// mascot (or, in the German trainer, Ella the owl); three texts are reworded
// by hand below. The private word list (~/.config/lernplattform/pii-words.txt)
// is used to find them, so no name is spelled in this file; the run fails if
// any listed word survives in the output.
//
// After this run the content files are the source of truth; this tool is kept
// for the record and is removed with the old pages after the switch.
import { mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { webkit } from 'playwright';
import { startServer } from './serve.mjs';
import { loadWords, wordListPath } from './check-pii.mjs';
import { QUIZ_INTERVALS, NOUN_INTERVALS } from '../app/core/srs.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const FORCE = process.argv.includes('--force');

const MASCOTS = {
  water:     { key: 'water', name: 'Tropfi' },
  book:      { key: 'book', name: 'Zacki' },
  magnetism: { key: 'magnetism', name: 'Ferro' },
  whales:    { key: 'whales', name: 'Walli' },
};
const ARCHIVE = new Set(['water', 'book', 'magnetism']);   // last year's topics (DECISIONS 2026-10-18)

// Hand-reworded texts (by question id). No name, no possessive.
const REWORD = {
  'formen-h1ftyaf6': {
    question: 'Du stellst ein Glas Wasser in den Gefrierschrank. Was passiert mit dem Wasser?',
    question_it: "Metti un bicchiere d'acqua nel congelatore. Cosa succede all'acqua?",
  },
  'mag_magnetfeld-h53p5ve': {
    hint: 'These lines are drawn in the lapbook! They show the shape of the magnetic field.',
    hint_it: 'Queste linee sono disegnate nel lapbook! Mostrano la forma del campo magnetico.',
  },
  'mag_anwendungen-hikeymi': {
    hint: 'Alle 6 stehen im Lapbook "Magnets at Work"! Denk an die Bilder! / All 6 are in the "Magnets at Work" lapbook!',
    hint_it: 'Tutti e 6 sono nel lapbook "Magnets at Work"!',
  },
};

// ── names ──────────────────────────────────────────────────────────────
const words = loadWords();
if (!words || !words.length) {
  console.error(`extract-banks: the private word list is needed (${wordListPath()})`);
  process.exit(2);
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME = `(?:${words.map(esc).join('|')})`;
const anyName = new RegExp(`(?<![\\p{L}\\p{N}])${NAME}`, 'iu');
const tfDe = new RegExp(`^Stimmt das, was ${NAME} sagt\\?( \\/ Is ${NAME} right\\?)?$`, 'iu');
const tfIt = new RegExp(`^${NAME} ha ragione\\?$`, 'iu');

/** Replace a name by `who` (trainer examples). */
const swapName = (s, who) => (typeof s === 'string' ? s.replace(new RegExp(`(?<![\\p{L}\\p{N}])${NAME}`, 'giu'), who) : s);

// ── helpers ────────────────────────────────────────────────────────────
const t = (de, it) => {
  const o = { de: String(de ?? '') };
  if (typeof it === 'string' && it.trim()) o.it = it;
  return o;
};
const emojiLabel = label => {
  const m = /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}\p{Emoji_Modifier}]*)\s+(.*)$/u.exec(label || '');
  return m ? { icon: m[1], de: m[2] } : { icon: null, de: label || '' };
};
function writeJson(rel, data) {
  const file = join(ROOT, rel);
  if (existsSync(file) && !FORCE) throw new Error(`${rel} exists — use --force to overwrite`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
function writeText(rel, text) {
  const file = join(ROOT, rel);
  if (existsSync(file) && !FORCE) throw new Error(`${rel} exists — use --force to overwrite`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

// ── conversion of one question ─────────────────────────────────────────
const figures = new Map();   // svg → relative path under assets/
function figureFile(svg, moduleId) {
  if (figures.has(svg)) return figures.get(svg);
  let out = svg.trim()
    .replace(/^<svg\b([^>]*?)\sstyle="[^"]*"/, '<svg$1')   // layout belongs to the app, not the file
    .replace(/\s+/g, ' ');
  if (!/xmlns=/.test(out.slice(0, 200))) out = out.replace(/^<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  const hash = createHash('sha256').update(out).digest('hex').slice(0, 10);
  const rel = `figures/${moduleId}/${hash}.svg`;
  writeText(`assets/${rel}`, out + '\n');
  figures.set(svg, rel);
  return rel;
}

function convert(x, moduleId) {
  const fix = REWORD[x.id] || {};
  const src = { ...x, ...fix };
  const mascot = MASCOTS[moduleId].name;
  let prompt = t(src.question, src.question_it);
  if (src.type === 'truefalse') {
    // the mascot speaks the statement
    if (tfDe.test(prompt.de)) prompt.de = prompt.de.includes(' / Is ') ? `Stimmt das, was ${mascot} sagt? / Is ${mascot} right?` : `Stimmt das, was ${mascot} sagt?`;
    if (prompt.it && tfIt.test(prompt.it)) prompt.it = `${mascot} ha ragione?`;
  }
  const q = { id: x.id, type: null, prompt };
  if (src.hint || src.hint_it) q.hint = t(src.hint, src.hint_it);
  if (src.answer_text || src.answer_text_it) q.explain = t(src.answer_text, src.answer_text_it);
  if (src.figure) q.media = { figure: figureFile(src.figure, moduleId) };
  const idx = (list, v) => { const i = list.indexOf(v); if (i < 0) throw new Error(`${x.id}: answer "${v}" not among the options`); return i; };

  switch (x.type) {
    case 'mcq':
      q.type = 'choice';
      q.answer = { options: x.options.map((o, i) => t(o, x.options_it?.[i])), correct: idx(x.options, x.correct) };
      break;
    case 'multiselect':
      q.type = 'multi';
      q.answer = { options: x.options.map((o, i) => t(o, x.options_it?.[i])), correct: x.correct.map(c => idx(x.options, c)) };
      break;
    case 'truefalse':
      q.type = 'bool';
      q.answer = { statement: t(x.statement, x.statement_it), correct: x.correct === true };
      break;
    case 'fitb':
      q.type = 'text';
      q.answer = { prefix: t(x.prefix, x.prefix_it), suffix: t(x.suffix, x.suffix_it), accepted: x.answer.slice() };
      break;
    case 'sequence':
      q.type = 'order';
      q.answer = { items: x.items.map((s, i) => t(s, x.items_it?.[i])), correct: x.correctOrder.slice() };
      break;
    case 'dragmatch':
      q.type = 'pairs';
      q.answer = { pairs: x.pairs.map((p, i) => ({ left: t(p.left, x.pairs_it?.[i]?.left), right: t(p.right, x.pairs_it?.[i]?.right) })) };
      break;
    case 'imageChoice':
      q.type = 'image';
      q.answer = { options: x.options.map(o => ({ emoji: o.emoji, label: t(o.label) })), correct: x.correct };
      break;
    case 'cycleDiagram':
      q.type = 'cycle';
      q.answer = { lang: x.lang, gapStep: x.gapStep, options: x.options.map((o, i) => t(o, x.options_it?.[i])), correct: idx(x.options, x.correct) };
      break;
    default:
      throw new Error(`${x.id}: unknown type ${x.type}`);
  }
  return q;
}

// ── read the old pages ─────────────────────────────────────────────────
const { server, url } = await startServer({ port: 0 });
const browser = await webkit.launch();
let quiz, gram;
try {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', r => {
    const u = new URL(r.request().url());
    return (u.hostname === 'localhost' || u.hostname === '127.0.0.1') ? r.continue() : r.abort();
  });
  await page.goto(url + 'index.html'); await page.waitForTimeout(800);
  quiz = await page.evaluate(() => {
    const out = {};
    for (const [key, m] of Object.entries(EDITOR_MODULES)) {
      if (typeof m.getQB !== 'function') continue;
      const meta = {};
      for (const [k, v] of Object.entries(m)) if (typeof v !== 'function') meta[k] = v;
      out[key] = { meta, bank: JSON.parse(JSON.stringify(m.getQB())) };
    }
    return { modules: out, TOPICS, CYCLE_STEPS };
  });
  await page.goto(url + 'grammatik.html'); await page.waitForTimeout(800);
  gram = await page.evaluate(() => JSON.parse(JSON.stringify({
    NOUNS, TEMPLATES_AKK, TEMPLATES_DAT, PATH_AKK, PATH_DAT, PATH_NOMEN, WORTBAU_POOL, CAT_LABELS,
  })));
  if (errors.length) throw new Error('page errors: ' + errors.join('; '));
} finally {
  await browser.close();
  server.close();
}

// ── quiz modules ───────────────────────────────────────────────────────
const counts = {};
for (const [moduleId, { meta, bank }] of Object.entries(quiz.modules)) {
  const topics = [];
  let n = 0;
  for (const topicId of meta.tkeys) {
    const list = bank[topicId] || [];
    const lab = emojiLabel(meta.topicLabels?.[topicId]);
    const itLabel = moduleId === 'water' ? quiz.TOPICS[topicId]?.it : null;
    topics.push({ id: topicId, label: t(lab.de, itLabel), icon: lab.icon, file: `${topicId}.json` });
    writeJson(`content/${moduleId}/${topicId}.json`, { items: list.map(x => convert(x, moduleId)) });
    n += list.length;
  }
  const extra = Object.keys(bank).filter(k => !meta.tkeys.includes(k));
  if (extra.length) throw new Error(`${moduleId}: topics outside tkeys: ${extra.join(', ')}`);
  const mod = {
    id: moduleId,
    name: t(meta.name, meta.nameIt),
    icon: meta.icon,
    subject: t(meta.subject, meta.subjectIt),
    grades: [meta.grade],
    archive: ARCHIVE.has(moduleId),
    engine: 'quiz',
    mascot: MASCOTS[moduleId],
    idPrefix: meta.idPrefix ?? '',
    legacyStorageKey: meta.storageKey,
    successTitle: t(meta.successTitle, meta.successTitleIt),
    srs: { intervals: [...QUIZ_INTERVALS] },
    topics,
  };
  if (moduleId === 'water') mod.cycleSteps = quiz.CYCLE_STEPS;
  writeJson(`content/${moduleId}/module.json`, mod);
  counts[moduleId] = n;
}

// ── the noun pack (Deutsch mit Ella, Wort-Regen) ───────────────────────
const ELLA = 'Ella';
const deepSwap = v => (typeof v === 'string' ? swapName(v, ELLA) : Array.isArray(v) ? v.map(deepSwap)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deepSwap(x)])) : v);

const categories = {};
for (const [id, label] of Object.entries(gram.CAT_LABELS)) { const l = emojiLabel(label); categories[id] = { label: t(l.de), icon: l.icon }; }
if (!categories.abstrakt) categories.abstrakt = { label: t('Gedanken & Gefühle'), icon: '💭' };   // was missing (STOCKTAKE §7)

const nouns = gram.NOUNS.map(n => {
  const o = { de: n.de, g: n.g, pl: n.pl ?? null, it: n.it ?? null, itG: n.itG ?? null, em: n.em, cat: n.cat };
  if (n.obl) o.obl = n.obl;
  if (n.rule) o.rule = n.rule;
  return o;
});
const unit = u => {
  const o = { n: u.n, title: u.title, lessonHtml: u.lesson.replace(/\n\s+/g, '\n').trim() };
  if (u.items && u.items.length) o.items = u.items;
  return o;
};
writeJson('content/nouns/pack.json', {
  id: 'nouns',
  about: 'German nouns with article, plural and Italian, used by Deutsch mit Ella and Wort-Regen. Card ids are the noun itself (keys of gram_srs_<P>).',
  srs: { intervals: [...NOUN_INTERVALS], fuzz: 1 },
  files: { nouns: 'nouns.json', categories: 'categories.json', templates: 'templates.json',
    paths: { akk: 'path-akk.json', dat: 'path-dat.json', nomen: 'path-nomen.json' }, wortbau: 'wortbau.json' },
});
writeJson('content/nouns/nouns.json', { items: nouns });
writeJson('content/nouns/categories.json', categories);
writeJson('content/nouns/templates.json', deepSwap({ akk: gram.TEMPLATES_AKK, dat: gram.TEMPLATES_DAT }));
writeJson('content/nouns/path-akk.json', { units: deepSwap(gram.PATH_AKK.map(unit)) });
writeJson('content/nouns/path-dat.json', { units: deepSwap(gram.PATH_DAT.map(unit)) });
writeJson('content/nouns/path-nomen.json', { units: deepSwap(gram.PATH_NOMEN.map(unit)) });
writeJson('content/nouns/wortbau.json', { items: deepSwap(gram.WORTBAU_POOL) });

// ── final guard: no listed word may survive ────────────────────────────
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const left = walk(join(ROOT, 'content')).filter(f => anyName.test(readFileSync(f, 'utf8')));
if (left.length) {
  console.error(`extract-banks: a private word is still present in: ${left.map(f => f.slice(ROOT.length + 1)).join(', ')}`);
  process.exit(1);
}
console.log(`extract-banks: ${JSON.stringify(counts)}, ${nouns.length} nouns, ${figures.size} figures — no private words in content/.`);
