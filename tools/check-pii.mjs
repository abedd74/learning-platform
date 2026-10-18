// Personal-data and secret scan.
//
//   node tools/check-pii.mjs                  all tracked files (working tree)
//   node tools/check-pii.mjs --staged         files staged for commit (index version)
//   node tools/check-pii.mjs --message FILE   a commit message
//   add --require-words to fail when the private word list is missing (git hooks do)
//
// Two kinds of rules:
//  1. Structural patterns, always on: a family link with a value, e-mail
//     addresses, phone numbers, home-folder paths, machine names, API keys
//     outside the sync file, tokens and private keys.
//  2. A private word list (children's names etc.) read from a file OUTSIDE the
//     repository: $LP_PII_WORDS or ~/.config/lernplattform/pii-words.txt.
//     One word per line, '#' starts a comment. A word matches at the start of
//     a word, case-insensitively, so genitive forms ("…s") are caught too.
//
// Hits are printed as file:line:column and the rule name; matched text is
// masked so the scan itself never repeats a name or a secret.
// Exit code: 0 clean, 1 hits found, 2 usage or setup error.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// The old single-file pages still contain the names. They are replaced at the
// switch (DESIGN §10) and then moved to legacy/ and removed; until then they
// are exempt from the word list (structural rules still apply to them).
export const LEGACY_EXEMPT = new Set(['index.html', 'grammatik.html', 'wortregen.html']);

// Files allowed to contain the public Firebase web config.
const FIREBASE_CONFIG_FILES = new Set(['sync.js', 'app/core/sync.js', 'legacy/sync.js']);

const BINARY = new Set(['.mp3', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.pdf', '.woff', '.woff2', '.zip']);

const ALLOWED_EMAILS = [/^noreply@anthropic\.com$/i, /@users\.noreply\.github\.com$/i, /@example\.(com|org|net)$/i, /\.test$/i];

export const RULES = [
  { name: 'family-code-in-link', re: /familie=(?=[^\s&"'`)<>]*\d)[A-Za-z0-9_-]{8,}/g },
  // A real family code is a long random string (the Firestore rules require 16+).
  { name: 'family-code-path',    re: /families\/[A-Za-z0-9_-]{16,}/g },
  { name: 'family-code-literal', re: /family_sync_id['"`]?\s*[,:=]\s*['"`][A-Za-z0-9_-]{16,}/g },
  { name: 'email',               re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    allow: m => ALLOWED_EMAILS.some(a => a.test(m)) },
  { name: 'phone',               re: /(?:\+|00)(?:39|41|43|49)[\s\/-]?\(?\d[\d\s\/()-]{6,}\d|\b01[5-7]\d[\s\/-]?\d{6,}\b/g },
  { name: 'home-folder-path',    re: /\/Users\/[A-Za-z][\w.-]*\/|C:\\Users\\[A-Za-z][\w.-]*\\/g },
  { name: 'machine-name',        re: /\b(?:MacBook|iMac|Mac-?mini)(?:-[A-Za-z0-9]+)*\.local\b/gi },
  { name: 'google-api-key',      re: /AIza[0-9A-Za-z_-]{35}/g, fileAllow: f => FIREBASE_CONFIG_FILES.has(f) },
  { name: 'github-token',        re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b/g },
  { name: 'anthropic-key',       re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: 'private-key',         re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
];

export function wordListPath() {
  return process.env.LP_PII_WORDS || join(homedir(), '.config', 'lernplattform', 'pii-words.txt');
}

export function loadWords(path = wordListPath()) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8')
    .split('\n')
    .map(l => l.replace(/#.*/, '').trim())
    .filter(Boolean);
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function wordRules(words) {
  return (words || []).map((w, i) => ({
    name: `private-word-${i + 1}`,
    re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(w)}`, 'giu'),
    isWord: true,
  }));
}

export function mask(s) {
  if (s.length <= 2) return '*'.repeat(s.length);
  return s[0] + '*'.repeat(Math.min(s.length - 1, 8));
}

// Scan one text; returns [{line, col, rule, masked}]
export function scanText(text, { file = '', words = null } = {}) {
  const hits = [];
  const rules = [...RULES, ...(LEGACY_EXEMPT.has(file) ? [] : wordRules(words))];
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const pos = idx => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, col: idx - lineStarts[lo] + 1 };
  };
  for (const r of rules) {
    if (r.fileAllow && r.fileAllow(file)) continue;
    r.re.lastIndex = 0;
    for (const m of text.matchAll(r.re)) {
      if (r.allow && r.allow(m[0])) continue;
      hits.push({ ...pos(m.index), rule: r.name, masked: mask(m[0]) });
    }
  }
  return hits.sort((a, b) => a.line - b.line || a.col - b.col);
}

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, maxBuffer: 64 * 1024 * 1024, ...opts });
}

function listFiles(staged) {
  const out = staged
    ? git(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'])
    : git(['ls-files', '-z']);
  return out.toString('utf8').split('\0').filter(Boolean);
}

function readFile(file, staged) {
  return staged ? git(['show', `:${file}`]).toString('utf8') : readFileSync(join(ROOT, file), 'utf8');
}

function main(argv) {
  const staged = argv.includes('--staged');
  const requireWords = argv.includes('--require-words');
  const msgIdx = argv.indexOf('--message');
  const words = loadWords();

  if (!words) {
    const note = `word list not found at ${wordListPath()} — only structural rules were checked`;
    if (requireWords) {
      console.error(`check-pii: ${note}.\nCreate it (one private word per line) or set LP_PII_WORDS.`);
      return 2;
    }
    console.warn(`check-pii: ${note}.`);
  }

  const results = [];
  if (msgIdx !== -1) {
    const file = argv[msgIdx + 1];
    if (!file) { console.error('check-pii: --message needs a file'); return 2; }
    const text = readFileSync(file, 'utf8').split('\n').filter(l => !l.startsWith('#')).join('\n');
    for (const h of scanText(text, { file: '<commit message>', words })) results.push({ file: '<commit message>', ...h });
  } else {
    for (const file of listFiles(staged)) {
      // File names count too
      for (const h of scanText(file, { file: '', words })) results.push({ file: `<path> ${mask(file)}`, ...h });
      if (BINARY.has(extname(file).toLowerCase())) continue;
      let text;
      try { text = readFile(file, staged); } catch { continue; }
      for (const h of scanText(text, { file, words })) results.push({ file, ...h });
    }
  }

  if (!results.length) {
    console.log(`check-pii: clean${words ? '' : ' (structural rules only)'}.`);
    return 0;
  }
  console.error(`check-pii: ${results.length} hit(s):`);
  for (const r of results) console.error(`  ${r.file}:${r.line}:${r.col}  ${r.rule}  ${r.masked}`);
  return 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
