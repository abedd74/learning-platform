// Content validator (DESIGN §5.3, content/README.md).
//
//   node tools/validate-content.mjs
//
// Errors block a commit (pre-commit hook) and the GitHub check; warnings are
// printed. Checks:
//  - quiz modules: module.json fields, topic files, and every question by type
//    (answer inside the options, a real order, accepted answers, …), ids with
//    the module prefix and unique across all content, figure files present
//  - the noun pack: articles, categories, templates, Lernpfad courses,
//    Wort-Bauen; lesson HTML limited to a few harmless tags
// Exit code: 0 valid (warnings allowed), 1 errors.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as srsConfig } from '../app/core/srs.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

export const QUESTION_TYPES = ['choice', 'multi', 'bool', 'text', 'order', 'pairs', 'image', 'cycle'];
export const ENGINES = ['quiz'];
const LESSON_TAGS = new Set(['p', 'b', 'i', 'em', 'strong', 'span', 'div', 'br', 'small', 'u']);
const LESSON_ATTRS = new Set(['class', 'style']);

const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const isStr = x => typeof x === 'string';
const nonEmpty = x => isStr(x) && x.trim().length > 0;
const isIdx = (i, n) => Number.isInteger(i) && i >= 0 && i < n;

/** A text: {de: string, it?: string}. `required`: de must be non-empty. */
function checkText(v, where, err, { required = true } = {}) {
  if (!isObj(v)) { err(`${where}: expected {de, it?}`); return false; }
  if (!isStr(v.de) || (required && !v.de.trim())) { err(`${where}: missing German text`); return false; }
  if ('it' in v && !isStr(v.it)) err(`${where}: "it" must be text`);
  for (const k of Object.keys(v)) if (k !== 'de' && k !== 'it') err(`${where}: unknown language "${k}"`);
  return true;
}

function checkOptions(list, where, err, min = 2) {
  if (!Array.isArray(list) || list.length < min) { err(`${where}: needs at least ${min} options`); return 0; }
  list.forEach((o, i) => checkText(o, `${where}[${i}]`, err));
  const des = list.map(o => o?.de);
  if (new Set(des).size !== des.length) err(`${where}: two options are the same`);
  return list.length;
}

/** Check one question. `ctx`: {module, assetsDir}. Returns nothing; reports through err/warn. */
export function checkQuestion(q, where, err, warn, ctx = {}) {
  if (!isObj(q)) { err(`${where}: not an object`); return; }
  if (!nonEmpty(q.id)) err(`${where}: missing id`);
  if (!QUESTION_TYPES.includes(q.type)) { err(`${where}: unknown type "${q.type}"`); return; }
  checkText(q.prompt, `${where}.prompt`, err);
  if (q.hint !== undefined) checkText(q.hint, `${where}.hint`, err, { required: false });
  if (q.explain !== undefined) checkText(q.explain, `${where}.explain`, err, { required: false });
  if (q.media !== undefined) {
    if (!isObj(q.media) || !nonEmpty(q.media.figure)) err(`${where}.media: expected {figure}`);
    else if (ctx.assetsDir && !existsSync(join(ctx.assetsDir, q.media.figure))) err(`${where}.media: figure ${q.media.figure} not found`);
  }
  const a = q.answer;
  if (!isObj(a)) { err(`${where}: missing answer`); return; }
  const at = `${where}.answer`;
  switch (q.type) {
    case 'choice': {
      const n = checkOptions(a.options, `${at}.options`, err);
      if (n && !isIdx(a.correct, n)) err(`${at}.correct: not one of the options`);
      break;
    }
    case 'multi': {
      const n = checkOptions(a.options, `${at}.options`, err);
      if (!Array.isArray(a.correct) || !a.correct.length) err(`${at}.correct: needs at least one right option`);
      else if (n && (a.correct.some(i => !isIdx(i, n)) || new Set(a.correct).size !== a.correct.length)) err(`${at}.correct: indexes must be distinct options`);
      break;
    }
    case 'bool':
      checkText(a.statement, `${at}.statement`, err);
      if (typeof a.correct !== 'boolean') err(`${at}.correct: must be true or false`);
      break;
    case 'text':
      checkText(a.prefix, `${at}.prefix`, err, { required: false });
      checkText(a.suffix, `${at}.suffix`, err, { required: false });
      if (!Array.isArray(a.accepted) || !a.accepted.length || a.accepted.some(s => !nonEmpty(s))) err(`${at}.accepted: needs at least one answer`);
      if ('exact' in a && typeof a.exact !== 'boolean') err(`${at}.exact: must be true or false`);
      break;
    case 'order': {
      const n = checkOptions(a.items, `${at}.items`, err);
      const ok = Array.isArray(a.correct) && a.correct.length === n && [...a.correct].sort((x, y) => x - y).every((v, i) => v === i);
      if (n && !ok) err(`${at}.correct: must list every item exactly once`);
      break;
    }
    case 'pairs':
      if (!Array.isArray(a.pairs) || a.pairs.length < 2) err(`${at}.pairs: needs at least 2 pairs`);
      else a.pairs.forEach((p, i) => { checkText(p?.left, `${at}.pairs[${i}].left`, err); checkText(p?.right, `${at}.pairs[${i}].right`, err); });
      break;
    case 'image':
      if (!Array.isArray(a.options) || a.options.length < 2) err(`${at}.options: needs at least 2 options`);
      else {
        a.options.forEach((o, i) => { if (!nonEmpty(o?.emoji)) err(`${at}.options[${i}]: missing emoji`); checkText(o?.label, `${at}.options[${i}].label`, err); });
        if (!isIdx(a.correct, a.options.length)) err(`${at}.correct: not one of the options`);
      }
      break;
    case 'cycle': {
      const steps = ctx.module?.cycleSteps?.[a.lang];
      if (!Array.isArray(steps)) { err(`${at}.lang: no cycle steps for "${a.lang}" in module.json`); break; }
      if (!isIdx(a.gapStep, steps.length)) err(`${at}.gapStep: out of range`);
      const n = checkOptions(a.options, `${at}.options`, err);
      if (n && !isIdx(a.correct, n)) err(`${at}.correct: not one of the options`);
      else if (n && isIdx(a.gapStep, steps.length) && a.options[a.correct]?.de !== steps[a.gapStep]) err(`${at}: the right option is not the missing step "${steps[a.gapStep]}"`);
      break;
    }
  }
  for (const k of Object.keys(q)) if (!['id', 'type', 'prompt', 'hint', 'explain', 'media', 'answer', 'source', 'tags'].includes(k)) warn(`${where}: unknown field "${k}"`);
}

function hasItalian(q) {
  const a = q.answer || {};
  const texts = [q.prompt, a.statement, ...(a.options || []).map(o => o.label || o), ...(a.items || []), ...(a.pairs || []).flatMap(p => [p.left, p.right])].filter(Boolean);
  return texts.every(x => isStr(x.it) || !nonEmpty(x.de));
}

// ── the noun pack ──────────────────────────────────────────────────────
export function checkLessonHtml(html, where, err) {
  if (!isStr(html)) { err(`${where}: missing lesson`); return; }
  if (/<script|<iframe|<img|<object|<embed|javascript:/i.test(html)) err(`${where}: forbidden markup`);
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    const tag = m[1].toLowerCase();
    if (!LESSON_TAGS.has(tag)) err(`${where}: tag <${tag}> is not allowed`);
    for (const am of m[2].matchAll(/([a-zA-Z-]+)\s*=/g)) if (!LESSON_ATTRS.has(am[1].toLowerCase())) err(`${where}: attribute "${am[1]}" is not allowed`);
  }
}

function checkPathItem(it, where, err) {
  if (!isObj(it)) { err(`${where}: not an object`); return; }
  if (!['pmcq', 'pfill'].includes(it.kind)) { err(`${where}: unknown kind "${it.kind}"`); return; }
  if (!Array.isArray(it.opts) || it.opts.length < 2) err(`${where}: needs at least 2 options`);
  else if (!it.opts.includes(it.correct)) err(`${where}: the right answer "${it.correct}" is not among the options`);
  if (it.kind === 'pmcq' && (!nonEmpty(it.sent) || !nonEmpty(it.task))) err(`${where}: needs a sentence and a task`);
  if (it.kind === 'pfill' && (!nonEmpty(it.t) || !it.t.includes('___'))) err(`${where}: the sentence needs a ___ gap`);
}

export function validateNounPack(dir, err, warn) {
  const read = f => JSON.parse(readFileSync(join(dir, f), 'utf8'));
  let pack;
  try { pack = read('pack.json'); } catch (e) { err(`nouns/pack.json: ${e.message}`); return 0; }
  const files = pack.files || {};
  const want = [files.nouns, files.categories, files.templates, files.wortbau, ...Object.values(files.paths || {})];
  for (const f of want) if (!f || !existsSync(join(dir, f))) { err(`nouns/pack.json: file ${f} missing`); return 0; }
  try { srsConfig({ intervals: pack.srs?.intervals }); } catch (e) { err(`nouns/pack.json srs: ${e.message}`); }

  const cats = read(files.categories);
  for (const [id, c] of Object.entries(cats)) checkText(c?.label, `nouns/categories.${id}.label`, err);
  const nouns = read(files.nouns).items;
  const seen = new Set();
  nouns.forEach((n, i) => {
    const w = `nouns/${files.nouns} #${i}`;
    if (!nonEmpty(n?.de)) { err(`${w}: missing word`); return; }
    if (seen.has(n.de)) err(`${w}: "${n.de}" appears twice`);
    seen.add(n.de);
    if (!['der', 'die', 'das'].includes(n.g)) err(`${w} (${n.de}): article must be der, die or das`);
    if (!(n.cat in cats)) err(`${w} (${n.de}): unknown category "${n.cat}"`);
    if (!nonEmpty(n.em)) warn(`${w} (${n.de}): no picture (emoji)`);
    for (const k of ['pl', 'it', 'itG']) if (n[k] !== null && n[k] !== undefined && !isStr(n[k])) err(`${w} (${n.de}): ${k} must be text or null`);
    if (n.rule !== undefined && !['monat', 'tag'].includes(n.rule)) err(`${w} (${n.de}): unknown rule "${n.rule}"`);
  });

  const tpl = read(files.templates);
  for (const kase of ['akk', 'dat']) {
    if (!Array.isArray(tpl[kase]) || !tpl[kase].length) { err(`nouns/templates.${kase}: missing`); continue; }
    tpl[kase].forEach((x, i) => {
      const w = `nouns/templates.${kase}[${i}]`;
      if (!nonEmpty(x?.t) || !x.t.includes('%A') || !x.t.includes('%N')) err(`${w}: sentence needs %A and %N`);
      for (const c of x?.cats || []) if (!(c in cats)) err(`${w}: unknown category "${c}"`);
      for (const k of ['only', 'also']) for (const word of x?.[k] || []) if (!seen.has(word)) err(`${w}: "${word}" is not in the noun list`);
    });
  }

  for (const [k, f] of Object.entries(files.paths || {})) {
    const units = read(f).units;
    if (!Array.isArray(units) || !units.length) { err(`nouns/${f}: no units`); continue; }
    units.forEach((u, i) => {
      const w = `nouns/${f} unit ${i + 1}`;
      if (u.n !== i + 1) err(`${w}: units must be numbered 1, 2, 3, …`);
      if (!nonEmpty(u.title)) err(`${w}: missing title`);
      checkLessonHtml(u.lessonHtml, w, err);
      (u.items || []).forEach((it, j) => checkPathItem(it, `${w} item ${j + 1}`, err));
    });
  }
  read(files.wortbau).items.forEach((it, j) => checkPathItem(it, `nouns/${files.wortbau} item ${j + 1}`, err));
  return nouns.length;
}

// ── everything ─────────────────────────────────────────────────────────
export function validateAll(contentDir = join(ROOT, 'content'), assetsDir = join(ROOT, 'assets')) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  const ids = new Map();
  let modules = 0, items = 0, nouns = 0;
  if (!existsSync(contentDir)) return { errors, warnings, modules, items, nouns };
  const rel = f => relative(ROOT, f);

  for (const dir of readdirSync(contentDir).sort()) {
    const modDir = join(contentDir, dir);
    if (!statSync(modDir).isDirectory() || dir === 'schema') continue;
    if (existsSync(join(modDir, 'pack.json'))) { nouns += validateNounPack(modDir, err, warn); continue; }
    const modFile = join(modDir, 'module.json');
    if (!existsSync(modFile)) continue;

    let mod;
    try { mod = JSON.parse(readFileSync(modFile, 'utf8')); }
    catch (e) { err(`${rel(modFile)}: invalid JSON (${e.message})`); continue; }
    modules++;
    for (const k of ['id', 'name', 'engine', 'topics']) if (!(k in mod)) err(`${rel(modFile)}: missing "${k}"`);
    if (mod.id && mod.id !== dir) err(`${rel(modFile)}: id "${mod.id}" differs from folder "${dir}"`);
    if (mod.name) checkText(mod.name, `${rel(modFile)} name`, err);
    if (mod.engine && !ENGINES.includes(mod.engine)) err(`${rel(modFile)}: unknown engine "${mod.engine}"`);
    if (mod.grades !== undefined && (!Array.isArray(mod.grades) || mod.grades.some(g => !Number.isInteger(g)))) err(`${rel(modFile)}: grades must be whole numbers`);
    if (mod.srs) { try { srsConfig({ intervals: mod.srs.intervals }); } catch (e) { err(`${rel(modFile)} srs: ${e.message}`); } }
    if (!Array.isArray(mod.topics)) continue;
    const topicIds = new Set();
    let noItalian = 0;
    const prompts = new Map();

    for (const t of mod.topics) {
      if (!t || !t.id || !t.file) { err(`${rel(modFile)}: topic without id or file`); continue; }
      if (topicIds.has(t.id)) err(`${rel(modFile)}: topic "${t.id}" listed twice`);
      topicIds.add(t.id);
      if (t.label) checkText(t.label, `${rel(modFile)} topic ${t.id} label`, err);
      const tFile = join(modDir, t.file);
      if (!existsSync(tFile)) { err(`${rel(modFile)}: topic file ${t.file} not found`); continue; }
      let data;
      try { data = JSON.parse(readFileSync(tFile, 'utf8')); }
      catch (e) { err(`${rel(tFile)}: invalid JSON (${e.message})`); continue; }
      const list = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(list)) { err(`${rel(tFile)}: expected an array or {items: []}`); continue; }
      list.forEach((q, i) => {
        items++;
        const where = `${rel(tFile)} #${i}${q?.id ? ` (${q.id})` : ''}`;
        if (!q || typeof q.id !== 'string' || !q.id) { err(`${where}: missing id`); return; }
        if (mod.idPrefix !== undefined && !q.id.startsWith(mod.idPrefix)) err(`${where}: id lacks module prefix "${mod.idPrefix}"`);
        if (ids.has(q.id)) err(`${where}: duplicate id (also in ${ids.get(q.id)})`);
        else ids.set(q.id, where);
        checkQuestion(q, where, err, warn, { module: mod, assetsDir });
        if (q.prompt && !hasItalian(q)) noItalian++;
        const key = [q.type, q.prompt?.de, q.answer?.statement?.de, q.answer?.prefix?.de, q.answer?.suffix?.de].join('|').toLowerCase().replace(/\s+/g, ' ');
        if (prompts.has(key)) warn(`${where}: same question as ${prompts.get(key)}`);
        else prompts.set(key, q.id);
      });
    }
    if (noItalian) warn(`${dir}: ${noItalian} question(s) with some text not translated to Italian`);
  }
  return { errors, warnings, modules, items, nouns };
}

function main() {
  const { errors, warnings, modules, items, nouns } = validateAll();
  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (errors.length) {
    console.error(`validate-content: ${errors.length} error(s):`);
    for (const e of errors.slice(0, 200)) console.error(`  ${e}`);
    return 1;
  }
  console.log(modules || nouns
    ? `validate-content: ${modules} module(s), ${items} question(s), ${nouns} noun(s) — all valid${warnings.length ? `, ${warnings.length} warning(s)` : ''}.`
    : 'validate-content: no content files yet.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
