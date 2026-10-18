# Design — Lernplattform v2

Date: 18 October 2026. Status: **draft for Andrea's yes**. Builds on [STOCKTAKE.md](STOCKTAKE.md); line numbers there refer to the current app (`e19d4a1`).

Decisions this design assumes (from the stock-take questions and the follow-up):
1. Public history restarts fresh with one clean commit; the old history is kept in a private backup on the Mac.
2. Profiles (names, avatars, grades, options) come from the device and the family sync, never from the code. Storage keys keep today's names, so no progress moves.
3. Last year's modules (water, Krokodildieb, magnetism) stay playable as an archive.
4. One app with one scheduler, one planner and one audio channel; the three old addresses keep working.
5. Licences tightened gently: booklet sentences reworded as they move into data files, font self-hosted, voice clips kept with a source note, Commons pictures with credit lines for the states module.
6. Plus the additions agreed on 18 Oct: card = item × skill, a tested scheduler with a 90-day simulation, a planner across modules with a test-date mode, daily cloud snapshots with restore, a synced error log and a visible version, staging under `/next/` on the real iPad, Safari-engine smoke tests, a rulebook and a decision log.

---

## 1. Goals and non-goals

**Goals**
- The girls' app keeps working throughout; all progress, on every device and in the cloud, carries over unchanged.
- Content, engine and games are separate, checkable and extendable: a new module is "a data pack + at most one new engine".
- The spaced repetition is one tested module that any module can use, with a daily planner that works across modules.
- Nothing can be lost silently: snapshots, restore, error log, version.
- A future session (or Andrea) understands the project from `CLAUDE.md` and `docs/` in minutes.
- No personal data and no secrets in the repository, enforced by a check.

**Non-goals**
- No build step, no framework, no runtime dependencies. Node is used only for tools and tests; Playwright only for the smoke test.
- No accounts, no server, no analytics. Firestore stays the only backend, used as today.
- No fancy memory algorithm: transparent boxes with per-module intervals, explained in the app.

---

## 2. Architecture

```
GitHub Pages (static)                      iPad / iPhone Safari
┌──────────────────────────────┐           ┌────────────────────────────┐
│ index.html  (shell)          │  ──────►  │ app/boot.js reads          │
│ grammatik.html, wortregen.html (forwarders)│ version.json, imports      │
│ app/      ES modules         │           │ main.js?v=…                │
│ content/  JSON + SVG         │  fetch    │ localStorage = truth       │
│ assets/   audio, maps, pics  │  ──────►  │ FamilySync mirrors to      │
│ version.json                 │           │ Firestore (unchanged keys) │
└──────────────────────────────┘           └────────────────────────────┘
```

### 2.1 Folders

```
index.html                shell: <title>, one <script type=module src=app/boot.js>
grammatik.html            forwarders: keep the ?profil= parameter and open the
wortregen.html            right module in the shell (so old bookmarks keep working)
next/index.html           staging shell (section 10); removed after the switch
app/
  boot.js                 fetches version.json (no-store), imports main.js?v=<version>
  main.js                 wires core + engines + ui, starts the router
  core/
    storage.js            THE key registry: every key name, shape, namespace; safeLoad/safeSave/remove
    sync.js               FamilySync (today's logic moved, rules extended additively), snapshots
    profiles.js           family_profiles, first-run, detection of existing profiles from key names
    srs.js                pure scheduler: review(), isDue(), ladder; no Date.now() inside
    planner.js            session assembly across modules, budgets, test-date mode, streak
    content.js            loads module.json + topic files, validates shape at runtime (light)
    i18n.js               de/it strings and the toggle
    audio.js              one channel, iOS unlock on first tap, clip → speech fallback
    errors.js             window.onerror/unhandledrejection → app_errors ring buffer
    router.js             #/grid, #/module/<id>, #/eltern …
    time.js               today() in Europe/Berlin, addDays, parse of legacy formats
  engines/
    quiz/                 8 question types: one renderer each + one answer checker
    ella/                 gender + case drills, Lernpfad, Zoo, Meister-Check, Wort-Bauen
    wordrain/             the game, reads/writes gram_srs via srs.js
    mapquiz/              highlight → pick 1 of 3, tap, type; map packs (section 6.4)
  ui/
    screens/              profiles, grid, topics, session, results, eltern (dashboard, snapshots,
                          errors, export/import, proposals), settings
    components/           buttons, mascots, progress dots, diff view, map view
    theme.css             one stylesheet, module themes as CSS variables
content/
  schema/                 question.schema.json, noun.schema.json, map-pack.schema.json, module.schema.json
  water/ book/ magnetism/ whales/     module.json + one JSON per topic (explicit ids)
  nouns/                  module.json + nouns.json + templates.json + path-akk.json … (Ella)
  states/                 module.json + germany.json (16 regions) [phase 7]
  ATTRIBUTION.md          every third-party asset: file, source, author, licence
assets/
  audio/                  the 700 mp3 (unchanged path: audio/ stays where it is — see 5.5)
  figures/                SVG figures extracted from the whale module
  maps/                   germany-states.svg [phase 7]
  pictures/states/        16 monument pictures with credits [phase 7]
  fonts/                  Nunito, self-hosted
tools/
  extract-banks.mjs       one-off: reads today's HTML banks → JSON (phase 2)
  freeze-ids.mjs          one-off: today's hash ids written into the JSON; golden test
  validate-content.mjs    schema, ids, answers, translations, forbidden strings
  check-pii.mjs           structural patterns + an external forbidden-word list
  dump-live-ids.mjs       Playwright: opens the OLD app on the local server, dumps its ids (golden file)
  hooks/pre-commit        runs `npm run check` and the PII scan on staged files + message
tests/                    node --test: srs, planner, merges, checker, id stability, storage registry
tests/smoke/              Playwright (WebKit): open, create profile, answer one of each type, Eltern screens
docs/                     STOCKTAKE.md, DESIGN.md, DECISIONS.md, MIGRATION.md, CONTENT-AUTHORING.md
CLAUDE.md, README.md, .gitignore, package.json, .github/workflows/check.yml, firestore.rules, version.json
```

### 2.2 Runtime rules
- ES modules served as-is; content loaded with `fetch` relative to `import.meta.url`, so the root shell and the `/next/` shell share the same code.
- `storage.js` is the only file that knows key names. Every other module asks for `keys.srs(moduleFamily, profile)` etc. The registry is listed in `docs/MIGRATION.md` and checked by a test (no key written at runtime that is not registered).
- Content is never rendered as HTML. Text goes through `textContent`; the only HTML is the app's own templates. SVG figures are files, inserted as `<img>` or inline from the assets folder.
- No `alert/confirm/prompt`; in-app dialogs.
- All state changes go through `safeSave` → `FamilySync.markDirty`, as today.

---

## 3. Profiles and devices

- **Synced key `family_profiles`** (new): `{v:1, profiles:{ "<P>": {name, avatar, grade, gentle, createdAt, updatedAt} }}`. Merge: per profile, newer `updatedAt` wins; union of profiles. `<P>` is the storage name, identical to the display name typed into today's code; display name can differ from `<P>` later without touching keys.
- **Device-local keys** `app_profile` (last chosen), `app_settings` (sound, Italian, gentle override). Not synced, like `gram_lastProfile` today.
- **First run on a device** (no `family_profiles` after the first pull): "Wer lernt hier?" — name, avatar, grade, gentle mode. If old keys exist on the device (`wq_<P>`, `gram_srs_<P>`), their `<P>` are offered as "Profile gefunden" so nothing is retyped; the app only reads key names, it ships none.
- **Family link** as today (`?familie=`): after the pull the profiles appear on the device.
- **Eltern** becomes a mode (toggle in the footer, optional 4-digit PIN stored device-locally), not a profile that collects data. Legacy `wq_Eltern*` keys are left alone.
- Grade and gentle mode are profile fields: the grid filter and the game's mode read them; no code path names a child.
- Renaming a profile is not supported in v2 (would need a key migration); documented.

---

## 4. The learning core

### 4.1 Cards
A **card = item × skill**. Examples: (whale question, `answer`), (noun "Apfel", `gender`), (noun, `case-akk`), (Bayern, `name.tap`). The card id is `<itemId>` for single-skill items (today's ids unchanged) and `<itemId>:<skill>` for multi-skill items.

Card records keep today's shape with optional additions:
```
{ b, due, s, r, w, k, lz?, v? }
b   box (0..n)          due 'YYYY-MM-DD'      s seen   r right   w wrong (total, for the dashboard)
k   streak of first-try rights               lz leech score (recent wrongs, decays)   v record version
```
Stores stay per module family, same keys as today: `wq_srs_<P>` (quiz cards, ids prefixed per module), `gram_srs_<P>` (nouns; Ella and Wort-Regen), and new `map_srs_<P>` (map cards). Each store has the `mergeSrs` rule (more progress wins) — additive change in `sync.js`.

### 4.2 Scheduler (`srs.js`, pure)
```
review(record, outcome, today, cfg) → record'      outcome: 'first' | 'retry' | 'wrong'
isDue(record, today)                               ladderLevel(records, itemId, cfg) → skill index
cfg = { intervals:[…days], leechAfter:4, leechFactor:0.6, fuzz:0|1, ladder:[skills], unlockBox:2 }
```
- Boxes as today: first-try right → box +1, `k`+1, `lz`−1 (min 0); retry/wrong → box −1 (min 0), `k`=0, `lz`+1, `w`+1. Interval = `intervals[box]` (+ fuzz from a seeded PRNG passed in). Leech when `lz ≥ leechAfter`: interval × factor, min 2 days, **and** the planner shows the teaching view first (fact/explanation), then asks again.
- Per-module intervals: quizzes keep `[0,1,2,4,7,14]`, nouns keep `[0,1,2,4,8,16,32,64,90]` → no existing due date changes. New modules choose their own.
- Ladder: a skill's card is unlocked when the previous skill's record has `b ≥ unlockBox`. The planner prefers the highest unlocked skill. A mistake at a higher skill does not demote the lower one; that card simply comes back sooner.
- `today` is computed in `time.js` in `Europe/Berlin` (today's records use UTC dates; the one-day difference needs no conversion).
- Tests: unit tests for every rule; a **90-day simulation** with a model learner (forgets with probability rising with interval): assert due cards per day stay under the budget after the ramp-up, mastered share rises, no introduced card goes unseen longer than its interval + 3 days, leeches get the teaching view.

### 4.3 Planner (`planner.js`)
Inputs: profile, today, all stores, module configs, plan (`plan_<P>`, synced, newer wins: `{tests:{<module>:'YYYY-MM-DD'}, focus?:[modules]}`), today's record (`plan_days_<P>`, synced, field-wise max: `{<date>:{answers, right, new, bySkill, ms, modules:{…}}}`).

Output: a session of N cards with a reason each (`due`, `new`, `filler`, `rehearsal`, `test-prep`), and the streak/shield state derived from `plan_days`.

Rules (configurable, defaults = Ella's today): 10 cards per session, 50 answers per day, 5 new per session, 10 new per day, no new cards while > 20 are due, at most 4 grammar cards; due cards weakest-first, interleaved across modules and topics; then new cards (highest unlocked skill); then filler = not-yet-due cards nearest to due, round-robin across topics; a card missed in this session is re-asked after ≥ 3 other cards (rehearsal). **Test-date mode:** in the 10 days before `tests[module]`, that module's due cards go first, cards due within the next 3 days are pulled forward, its new-card limit doubles, and the results screen shows "noch 4 Tage". Meister-Check and the concept lifecycle stay as in Ella, as planner items with their own reasons.

`gram_days_<P>` keeps being written by the Ella engine (same fields) so old dashboards and the badge logic still work; `plan_days_<P>` is the cross-module record from the switch on.

---

## 5. Content

### 5.1 Schema (one shape for all question types)
```jsonc
{ "id": "wal_arten-h1k9z2",            // frozen today's id, or new: "<module>_<topic>-<slug>"
  "type": "choice",                     // choice | multi | bool | text | order | pairs | image | cycle
  "prompt":   { "de": "…", "it": "…" },
  "hint":     { "de": "…", "it": "…" },
  "explain":  { "de": "…", "it": "…" },  // today's answer_text
  "media":    { "figure": "figures/whales/parts.svg" },     // optional
  "answer":   { … per type, see below },
  "source":   "Arbeitsblatt Wale, Sept 2026",             // never a person
  "tags":     ["heft2"] }
```
| type | answer |
|---|---|
| choice | `{options:[{de,it}], correct: 2}` (index) |
| multi | `{options:[…], correct:[0,3]}` |
| bool | `{statement:{de,it}, correct:true}` — the speaker is the module mascot, never a child |
| text | `{prefix:{de,it}, suffix:{de,it}, accepted:["…"], lang:"de", exact:false}` |
| order | `{items:[{de,it}], correct:[2,0,1]}` |
| pairs | `{pairs:[{left:{de,it}, right:{de,it}}]}` |
| image | `{options:[{emoji,label:{de,it}}], correct:1}` |
| cycle | `{lang:"de", gapStep:3}` (water diagram; the options come from the diagram definition) |

`module.json`: `{id, name:{de,it}, icon, subject, grades:[3], engine:"quiz", theme, mascot, srs:{intervals}, topics:[{id, label:{de,it}, file}], idPrefix}`.
Nouns, templates, Lernpfad units and map packs have their own small schemas (`noun.schema.json`, `map-pack.schema.json`).

### 5.2 Ids: frozen, then explicit
- `tools/dump-live-ids.mjs` opens the **old** app on the local server with Playwright and writes `tests/fixtures/live-ids.json` (module → topic → [ids]) — the golden file.
- `tools/extract-banks.mjs` reads the banks out of the old HTML (Node `vm`), converts to the schema, and `tools/freeze-ids.mjs` ports `qContentHash`/`assignQuestionIds` exactly (incl. the `x` twin rule) to stamp ids.
- Test `id-stability`: ids in `content/**` == golden file, every id unique across all content. From then on ids are plain data; wording changes never touch progress.
- The 16 generated whale picture questions become static questions with SVG files in `assets/figures/whales/`.

### 5.3 Validator (`tools/validate-content.mjs`)
Errors (block the commit): unknown type, missing `prompt.de`, `correct` out of range or not in options, empty `accepted`, duplicate id, id prefix ≠ module prefix, unknown topic file, figure file missing, forbidden string (section 11). Warnings: missing Italian, mixed-language stems, near-duplicate prompts (normalised text), stale `source`.

### 5.4 Authoring and the editor
- Worksheet photo → draft topic JSON (Claude, in a session) → `npm run check` → preview on the local server → commit. `docs/CONTENT-AUTHORING.md` describes it; the school archive stays outside the repo; `source` never names a person.
- The in-app editor becomes **Vorschläge** (proposals): edit in Eltern mode → the diff is shown as JSON to copy or download → committed by a session. No runtime override of shipped content any more.
- Existing editor overrides (`wq_editor_*`) are harvested **before the switch** from a backup export Andrea makes on one device (Eltern → Export; the file stays in the vault, not in the repo). Differences are folded into the content files; the keys are then left alone.

### 5.5 Audio and assets
- `audio/` stays at its path (700 files, referenced by slug as today). `content/ATTRIBUTION.md` records the voice and tool used and the date; if the terms turn out to forbid redistribution, the clips are regenerated with a clearly licensed voice (one script, same file names).
- Font self-hosted in `assets/fonts/` (OFL licence file next to it).

---

## 6. Engines

### 6.1 Quiz
Eight renderers (one file each) + one checker `check(question, response) → {ok, retryAllowed, diff?}`; the text checker keeps today's lenient normalisation unless `exact:true`. Shared session screen: progress bar, prompt, hint, explain, mascot reaction, Italian toggle. Results screen per session with reasons (due/new/test-prep) and the next due day.

### 6.2 Ella (German trainer)
Same content and flow as today (gender drill with typed answers after 3 in a row, case drills with templates, Lernpfad units, Wörter-Zoo, badges, Meister-Check, Schatzkiste), but on the shared scheduler/planner/audio. Fixes folded in: `CAT_LABELS` gets "abstrakt", months/days get clips or stay speech-only by flag, `UNLOCK_DAT` either gates or goes.

### 6.3 Wort-Regen
The game reads the noun pack from `content/nouns/` (no second word list) and writes through `srs.js` into `gram_srs_<P>`, with the gentle mode from the profile. Metrics and high score keep their keys.

### 6.4 Map quiz (the states module, and any map later)
**Map pack** `content/states/germany.json`:
```jsonc
{ "id":"states-de", "map":"maps/germany-states.svg", "viewBox":"0 0 600 800",
  "regions":[{ "id":"DE-BY", "name":"Bayern", "capital":"München",
               "neighbours":["DE-BW","DE-HE","DE-TH","DE-SN"], "lookalikes":[],
               "fact":{"de":"…","it":"…"}, "picture":{"file":"pictures/states/DE-BY.jpg",
               "caption":{"de":"Schloss Neuschwanstein"}, "credit":"…", "licence":"CC BY-SA 4.0", "url":"…"},
               "small": false }] }
```
The SVG has one `<path id="DE-BY">` per region (source: Wikimedia Commons, simplified; credit in `ATTRIBUTION.md`).

**Skills (the ladder), each a card per region:** `name.pick3` (a state lights up → 3 names) → `name.tap` (a name is shown → tap the state) → `name.type` (a state lights up → type the name). Capitals: `capital.pick3` (state lit → 3 capitals) → `capital.state` (a capital is named → tap its state) → `capital.type` (state lit → type the capital). Unlock at `b ≥ 2` on the previous skill. Distractors: neighbours first, then look-alikes (Sachsen / Sachsen-Anhalt / Niedersachsen), then random. **Kennenlernen:** a region's first card opens with picture + fun fact before the first question; leeches see it again.

**Interaction:** inline SVG, pointer events, tap highlights the region and a "Fertig" button confirms (avoids mis-taps on small states); regions flagged `small` get an enlarged invisible hit area (≥ 44 pt) and a zoom lens on the phone (double-tap zooms into that corner). Typing: `<input lang="de" autocapitalize="words" autocorrect="off" spellcheck="false">`; compare after trim and Unicode NFC, exact spelling and capitals; on error show a letter-by-letter diff and ask once more (rehearsal). **Stumme Karte** session type: all 16 in a row, the blank-map test form, with a score and a printable result in Eltern mode.

The same engine takes Europe, rivers or districts later: one more pack, no code.

---

## 7. Sync, snapshots, rules

- `sync.js` keeps every existing rule and merge function; new rules are appended: `family_profiles` (per-profile newest), `map_srs_` (mergeSrs), `plan_days_` (max per entry), `plan_` (newest), `app_errors` (union, capped 200). Property tests for every merge: commutative, idempotent, associative on random data; fixtures taken from the backup export (anonymised: profile names replaced).
- Known wrinkles fixed additively: history dates parsed in both `d.m.yyyy` and `dd.mm.yyyy`; `gram_path` merge becomes deep for `mc`/`fest`/`passed` (a test shows the old shallow merge as a regression case).
- **Snapshots:** once a day, the first device that syncs after the day change writes `families/<code>/snapshots/<YYYY-MM-DD>` = all synced keys as one JSON (skip if it already exists; if > 900 KB, the editor keys are left out and noted). Keeps the last 30 (older ones deleted by the same device). **Restore** in Eltern mode: list dates → preview (keys, sizes, the profiles' answer counts) → apply = write local keys, mark dirty, push. Documented as the "Fallschirm".
- `firestore.rules` in the repo (deployed by Andrea in the Firebase console; the app does not need it to run): no `list` on `families`; `stores` and `snapshots` documents limited to the three fields and 1 MB; everything else denied. The web API key stays in the file as today.

---

## 8. Seeing what happens

- **Error log** `app_errors` (synced, union, capped): `{ts, version, page, message, stack (first 3 lines), profile:<P>}`; shown in Eltern mode with a "kopieren" button so Andrea can paste it to a session. A small red dot on the footer when a new error exists.
- **Version:** `version.json` `{version:"2026.11.03", commit:"…"}`; the footer shows `v2026.11.03 · Sync ✓/offline/aus`. `boot.js` loads `version.json` with `no-store` and imports `main.js?v=<version>`, so content and engine are never mismatched; a reload picks up the new version within GitHub Pages' cache window (10 min).
- **Eltern dashboard** across modules: today's and the week's answers per child and module, due today / tomorrow, weakest topics, leeches, streak; per-module detail; the old per-module stats keep working from `wq_stats_<P>`.

---

## 9. Quality and staying power

- `package.json` scripts: `check` (validate-content + tests + pii), `smoke` (Playwright WebKit on the local server), `serve`, `dump-ids`. Only dev dependency: `playwright`.
- `tools/hooks/pre-commit`: `npm run check` + PII scan over staged files and the commit message; enabled once with `git config core.hooksPath tools/hooks` (documented).
- GitHub Action `check.yml`: on every push and PR, `npm ci`, `npm run check`, `npx playwright install --with-deps webkit`, `npm run smoke`. Free for public repositories. A red check blocks the switch, not the push.
- **Tests** (node --test, no framework): srs rules + simulation, planner (budgets, interleave, rehearsal, test-date), merges (property tests), checker per type, id stability, storage registry, time (day boundary), profiles (detection, first run).
- **Smoke** (WebKit): open shell → first-run profile → grid → one session per engine answering one of each type → results → Eltern: dashboard, snapshot list (mocked fetch), error log → Ella session → Wort-Regen start → map session (phase 7).
- `CLAUDE.md`: the rules (no personal data, no secrets, keys only in `storage.js`, content only as data, every step a commit, never push without Andrea's yes, what to run before committing, how to add a topic, how to run on the iPad). `docs/DECISIONS.md`: one dated line per decision. `README.md`: what the project is, how to run it (no names).

---

## 10. Staging on the real iPad, then the switch

- **Staging:** `next/index.html` is the shell with `window.LP_NAMESPACE = 'next_'` and sync **off**. `storage.js` prefixes every key with the namespace, so the staging app never touches the live keys and never syncs (the old app's rules are anchored, so `next_…` keys are ignored by it). A button in staging, "Daten von diesem Gerät kopieren", copies the live keys into the namespace once (and again on demand). Andrea and the girls try the new app at `…/learning-platform/next/` with real data; nothing can break the live app or the cloud.
- Pushing the staging folder publishes it (the live `index.html` is untouched) → needs Andrea's yes like every push.
- **Switch** (one commit, after green checks, the smoke test, the iPad test and Andrea's yes): root `index.html` becomes the shell (namespace empty, sync on); `grammatik.html` and `wortregen.html` become forwarders; the old three files and the old `sync.js` move to `legacy/` (kept for one release, removed in a later commit); `next/` removed. First open on a device: nothing to migrate — the keys are the same; `family_profiles` is created from the detected `<P>` on the first device (confirmed by Andrea), then synced.
- **Rollback:** revert the switch commit and push; the old app returns and finds its data untouched (v2 only adds keys).
- Before the switch: Andrea exports a backup on one device (also used for 5.4 and the merge fixtures); the first snapshot is taken by the new app right after the switch.

---

## 11. Privacy, history clean-up

- **Forbidden-string check** (`tools/check-pii.mjs`): structural patterns always (`familie=` with a value, e-mail addresses, phone numbers, Firebase keys other than the known one, `MacBook`), plus a word list read from a file **outside the repo** (`~/.config/lernplattform/pii-words.txt`, maintained in the vault) — so the names themselves never enter the repository, not even in the check. Runs in the pre-commit hook and in `npm run check` (the Action runs without the word list).
- **Clean-up steps, in this order, each with Andrea's yes:** (1) backup: `git bundle` of the whole repository into the vault's backup folder + a zip of the project folder; (2) repository description on GitHub changed to a neutral sentence; (3) the clean tree (after the switch, `legacy/` removed, scan green) committed as a single root commit on an orphan branch; author set to the GitHub no-reply address; (4) `git push --force` of that branch as `main`, other remote branches deleted; (5) a request to GitHub Support to purge unreachable objects (text drafted by the session, sent by Andrea); (6) every local clone/worktree re-based on the new `main`.
- Locally: the family code is removed from `.claude/settings.local.json` (Andrea's yes), and the project gets a `.gitignore` (`.claude/`, `.DS_Store`, `node_modules/`, `wireframe.html`, `test-results/`).

---

## 12. Build plan

Each phase is a series of small commits on the worktree branch; nothing is pushed before phase 4. "Yes" marks a point that needs Andrea.

| Phase | What | Size | Needs Andrea |
|---|---|---|---|
| 0 Groundwork | `.gitignore`, `README`, `CLAUDE.md` v1, `DECISIONS.md`, `package.json`, tools skeleton, Action file, `firestore.rules` draft, golden id dump from the old app | S | export a backup from one device (file to the vault); clean `settings.local.json` (yes) |
| 1 Core | `storage.js` registry + namespace, `time.js`, `srs.js` + simulation, `planner.js`, `sync.js` as module + property tests + new rules + snapshots, `profiles.js`, `errors.js`, `boot.js`/version, `audio.js`, `i18n.js`, router | L | — |
| 2 Content | extraction of the four banks and the noun pack to JSON, id freeze + golden test, figures to files, validator, `ATTRIBUTION.md`, booklet sentences reworded, overrides from the backup folded in | M | — |
| 3 Engines & UI | quiz engine (8 types), Ella, Wort-Regen, screens, Eltern mode (dashboard, snapshots/restore, errors, export/import, proposals), theme, font self-hosted | L | — |
| 4 Staging | `next/` shell, smoke tests green, Action green; push (yes); iPad test with copied data; fix round | M | push (yes); try it on the iPad with the girls |
| 5 Switch | shells and forwarders, `legacy/`, push (yes); first snapshot; verify on both devices; rollback plan at hand | S | push (yes); confirm the detected profiles on the first device |
| 6 Clean-up | backup, description, orphan commit, force push (yes), Support request, Firestore rules deployed | S | yes at each step; Firebase console; Support form |
| 7 States module | map + 16 pictures with credits, pack JSON, map-quiz engine, ladder, Stumme Karte, test-date; staged under `?beta` or `next/`; push (yes) | L | pictures choice (photos vs drawings, done: Commons photos); test date when known |
| 8 Later | legacy removal, maths/English packs from worksheets, Europe map pack | — | — |

Order note: the clean-up (6) sits right after the switch because the names leave the public code only then; if the states topic starts at school before that, phase 7 can be built in parallel on its own branch and staged after the switch.

---

## 13. Risks and how they are held

| Risk | Held by |
|---|---|
| A key or shape changes by accident | registry test, MIGRATION.md, property tests on merges, staging on real data |
| Ids differ from the live app | golden dump from the old app + id-stability test |
| The new app misbehaves on the iPad only | WebKit smoke test; staging namespace; error log |
| Cloud data damaged by a merge bug | daily snapshots + restore; backup export before the switch |
| Personal data slips in | PII check in hook and Action; mascots as speakers; `source` rules |
| History rewrite goes wrong | bundle backup first; orphan branch reviewed before force push; rollback = push the bundle back |
| Edge TTS clips licensing | source note; regeneration script ready with a licensed voice |
| GitHub Pages cache serves old engine with new content | `boot.js` version import |

---

## 14. For the quick check

1. The six assumptions at the top — all right?
2. Staging under `/next/` with a copied data namespace and sync off — fine? (It means one push before the switch; the live app stays untouched.)
3. Before phase 2: a backup export from one device (Eltern → Export) goes to the vault, never into the repo — OK?
4. Order: switch → history clean-up → states module. When does the states topic start at school?
5. At the clean-up: Firebase console (rules) and the GitHub Support form are yours; commit author from then on = GitHub no-reply address?
