// The ledger of published question ids (tests/fixtures/published-ids.json).
//   node tools/ids-ledger.mjs      (npm run ledger)
//
// A question's id is the key of a child's progress on it. Once an id has been
// published it must stay: same module, same kind of question. This tool ADDS
// the ids of new questions to the ledger and never removes or changes one;
// tests/content-ids.test.mjs fails when content and ledger disagree. So a new
// question needs one deliberate step (run this, commit the ledger with the
// content), and renaming or dropping a published id cannot happen unnoticed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
export const LEDGER = join(ROOT, 'tests', 'fixtures', 'published-ids.json');
const read = p => JSON.parse(readFileSync(p, 'utf8'));

/** {moduleId: {questionId: type}} of everything in content/ right now. */
export function contentIds(root = ROOT) {
  const out = {};
  const index = read(join(root, 'content', 'index.json'));
  for (const m of index.modules || []) {
    if (m.kind !== 'quiz') continue;
    const mod = read(join(root, 'content', m.id, 'module.json'));
    const ids = out[m.id] = {};
    for (const t of mod.topics) {
      const data = read(join(root, 'content', m.id, t.file));
      for (const q of Array.isArray(data) ? data : data.items || []) ids[q.id] = q.type;
    }
  }
  return out;
}

export function readLedger() {
  return existsSync(LEDGER) ? read(LEDGER) : { about: 'Every question id ever published, with its module and type. Append-only: added by tools/ids-ledger.mjs, never edited by hand.', modules: {} };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ledger = readLedger();
  const now = contentIds();
  let added = 0;
  for (const [m, ids] of Object.entries(now)) {
    const have = ledger.modules[m] || (ledger.modules[m] = {});
    for (const [id, type] of Object.entries(ids)) if (!(id in have)) { have[id] = type; added++; }
  }
  if (added) writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n');
  const total = Object.values(ledger.modules).reduce((a, m) => a + Object.keys(m).length, 0);
  console.log(`ids-ledger: ${added} id(s) added, ${total} published in all.`);
}
