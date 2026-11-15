// Stamps version.json from what is in app/ and content/.
//   node tools/stamp-version.mjs      (npm run stamp)
//
// version.json is the one file the app always reads fresh. It says which
// version is online and lists the app's files, so that a device that last
// ran an older version re-fetches every file BEFORE it starts (boot.js) —
// GitHub Pages lets a browser keep a file for ten minutes, and without this
// a reload shortly after an update could pair new code with old code.
// The version changes exactly when a file in app/ or content/ changes:
// tests/version.test.mjs fails until this tool has been run again.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join, relative, sep } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

function walk(dir, out = []) {
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}
const rel = p => relative(ROOT, p).split(sep).join('/');

/** {hash, files}: a fingerprint of app/ and content/, and the app's own files (relative to app/). */
export function fingerprint(root = ROOT) {
  const h = createHash('sha256');
  const all = [...walk(join(root, 'app')), ...walk(join(root, 'content'))];
  for (const p of all) h.update(`${relative(root, p).split(sep).join('/')}\0${createHash('sha256').update(readFileSync(p)).digest('hex')}\n`);
  const files = walk(join(root, 'app')).filter(p => /\.(js|css)$/.test(p)).map(p => relative(join(root, 'app'), p).split(sep).join('/'));
  return { hash: h.digest('hex'), files };
}

export function readStamp(root = ROOT) {
  try { return JSON.parse(readFileSync(join(root, 'version.json'), 'utf8')); } catch { return null; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { hash, files } = fingerprint();
  const old = readStamp();
  if (old && old.hash === hash && JSON.stringify(old.files) === JSON.stringify(files)) {
    console.log(`stamp-version: up to date (${old.version}).`);
  } else {
    const d = new Date();
    const day = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
    const version = `${day}-${hash.slice(0, 7)}`;
    writeFileSync(join(ROOT, 'version.json'), JSON.stringify({ version, hash, files }, null, 1) + '\n');
    console.log(`stamp-version: ${rel(join(ROOT, 'version.json'))} → ${version} (${files.length} app files).`);
  }
}
