// Content validator.
//
//   node tools/validate-content.mjs
//
// Phase 0 skeleton: finds every content/<module>/module.json, parses it and
// the topic files it lists, and checks the rules that will not change:
// valid JSON, required module fields, every listed topic file exists, every
// question has an id with the module's prefix, and ids are unique across all
// content. The per-type schema checks arrive with the content files (phase 2,
// DESIGN §5.3).
// Exit code: 0 valid (warnings allowed), 1 errors.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONTENT = join(ROOT, 'content');

const MODULE_REQUIRED = ['id', 'name', 'engine', 'topics'];

export function validateAll(contentDir = CONTENT) {
  const errors = [], warnings = [];
  const ids = new Map();   // id → file
  let modules = 0, items = 0;

  if (!existsSync(contentDir)) return { errors, warnings, modules, items };

  for (const dir of readdirSync(contentDir).sort()) {
    const modDir = join(contentDir, dir);
    if (!statSync(modDir).isDirectory() || dir === 'schema') continue;
    const modFile = join(modDir, 'module.json');
    if (!existsSync(modFile)) continue;
    const rel = f => relative(ROOT, f);

    let mod;
    try { mod = JSON.parse(readFileSync(modFile, 'utf8')); }
    catch (e) { errors.push(`${rel(modFile)}: invalid JSON (${e.message})`); continue; }
    modules++;

    for (const k of MODULE_REQUIRED) if (!(k in mod)) errors.push(`${rel(modFile)}: missing "${k}"`);
    if (mod.id && mod.id !== dir) errors.push(`${rel(modFile)}: id "${mod.id}" differs from folder "${dir}"`);
    if (!Array.isArray(mod.topics)) continue;

    for (const t of mod.topics) {
      if (!t || !t.id || !t.file) { errors.push(`${rel(modFile)}: topic without id or file`); continue; }
      const tFile = join(modDir, t.file);
      if (!existsSync(tFile)) { errors.push(`${rel(modFile)}: topic file ${t.file} not found`); continue; }
      let data;
      try { data = JSON.parse(readFileSync(tFile, 'utf8')); }
      catch (e) { errors.push(`${rel(tFile)}: invalid JSON (${e.message})`); continue; }
      const list = Array.isArray(data) ? data : data.items;
      if (!Array.isArray(list)) { errors.push(`${rel(tFile)}: expected an array or {items: []}`); continue; }
      list.forEach((q, i) => {
        items++;
        const where = `${rel(tFile)} #${i}`;
        if (!q || typeof q.id !== 'string' || !q.id) { errors.push(`${where}: missing id`); return; }
        if (mod.idPrefix !== undefined && !q.id.startsWith(mod.idPrefix)) {
          errors.push(`${where}: id "${q.id}" lacks module prefix "${mod.idPrefix}"`);
        }
        if (ids.has(q.id)) errors.push(`${where}: duplicate id "${q.id}" (also in ${ids.get(q.id)})`);
        else ids.set(q.id, where);
      });
    }
  }
  return { errors, warnings, modules, items };
}

function main() {
  const { errors, warnings, modules, items } = validateAll();
  for (const w of warnings) console.warn(`  warning: ${w}`);
  if (errors.length) {
    console.error(`validate-content: ${errors.length} error(s):`);
    for (const e of errors) console.error(`  ${e}`);
    return 1;
  }
  console.log(modules
    ? `validate-content: ${modules} module(s), ${items} item(s), all valid.`
    : 'validate-content: no content files yet.');
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
