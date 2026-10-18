# Stock-take of the Lernplattform

Date: 18 October 2026. State examined: commit `e19d4a1` on `main`, which is byte-for-byte what GitHub Pages serves today. Nothing in the app was changed for this report. Line numbers refer to the files at that commit.

Rules followed while writing this: the children are called "the older child" (Klasse 4) and "the younger child" (Klasse 2); no name, grade start date, secret code or key is copied into this document.

---

## 1. Summary

1. The app is three separate single-file web pages that share one cloud-sync script: `index.html` (quiz modules), `grammatik.html` ("Deutsch mit Ella", the German trainer) and `wortregen.html` (the Wort-Regen game). They are bookmarked directly on the iPad, so their URLs matter.
2. There are 378 quiz questions in four modules inside `index.html` (water cycle, the book "Der Krokodildieb", magnetism, whales), 350 nouns with 700 voice clips in the German trainer, and placeholder cards for maths/English that have no content.
3. All content is JavaScript inside the HTML files (about 295 KB of the 477 KB `index.html`). There is no schema, no validation and no separation between content and engine.
4. The spaced repetition exists twice with different settings: a 6-box version in `index.html` and a 9-box version with daily budget, streak and Meister-Check in `grammatik.html`. Wort-Regen writes into the trainer's records.
5. Progress lives in `localStorage` under about 20 key patterns (section 6) and is mirrored to Firestore by `sync.js`, with per-key merge rules. **The children's display names are part of the key names.** This is the contract any migration must keep.
6. A question's identity is a hash of its wording. Changing the wording of a question silently orphans its progress.
7. Fragile: one 3,650-line script holds three content banks and the start-up code (one typo disables four modules and the sync); five functions are declared twice; an in-app editor can override the shipped content family-wide; a version stamp that was never bumped since March.
8. Personal data: the children's first names appear about 150 times across the three pages (profile cards, example sentences, "X sagt:" in every true/false question), together with their grades, school-year timing, a school test date, a lapbook title and notes about one child's learning pace and the other's need for a gentle mode. The names are in **every one of the 67 commits**, in 4 commit messages and in the public repository description on GitHub.
9. No secrets in the repository: the family code is not in any commit. Locally on the Mac, the git-ignored `.claude/settings.local.json` contains it in old permission entries and should be cleaned.
10. Licences: everything visible is hand-drawn SVG or own text; the voice clips come from a neural TTS voice with no licence note; some whale sentences follow the school booklet word-for-word; Google Fonts is loaded from Google.

---

## 2. What exists

### 2.1 Modules in `index.html` (quiz engine)

| Module | Grade tag | Topics | Questions | Types | Languages |
|---|---|---|---|---|---|
| Wasserkreislauf (`water`) | 3 | 6 | 64 | mcq, true/false, fill-in, image choice, sequence, drag-match, cycle diagram (12) | DE + IT; 10 questions are English-only |
| Der Krokodildieb (`book`) | 3 | 21 chapters + 3 cross-cutting | 109 | mcq (81), fill-in, multiselect, drag-match, sequence | DE + IT |
| Magnetismus (`magnetism`) | 3 | 9 | 81 | mcq, fill-in (27), true/false, drag-match, multiselect | DE + EN mixed in the same field in ~51 stems; hints often English-only; IT present |
| Wale (`whales`) | 4 | 12 (incl. "Heft 2") | 124 | mcq (73), true/false, fill-in, multiselect, drag-match, sequence; 16 picture questions built by functions | DE + IT |
| Mathe 3, Mathe 1, Lesen 1 | 3 / 2 / 2 | — | 0 | "Kommt bald" cards only | — |

Totals: 378 questions; mcq 204, fitb 59, truefalse 49, multiselect 22, dragmatch 19, cycleDiagram 12, sequence 9, imageChoice 4. Every question has an Italian translation of the stem (`question_it`); options and pairs are not always translated.

Grade filter: the platform grid shows only cards whose grade equals the profile's grade (plus "all"). The older child (grade 4) sees whales, the trainer and Wort-Regen by default; water, book and magnetism (tagged 3) are hidden behind a grade pill. The younger child (grade 2) sees only "coming soon" cards and Wort-Regen. Parent and custom profiles see everything.

### 2.2 `grammatik.html` — "Deutsch mit Ella" (grade 4 card)

- 350 nouns (`NOUNS`, lines 509–873, plus months/weekdays pushed in at 878) with article, plural, Italian translation and gender, emoji, category, 12 categories; 178 are "traps" where the Italian gender misleads.
- Sentence templates for Akkusativ (14) and Dativ (8) case drills; article tables.
- Three "Lernpfad" courses (Akkusativ, Dativ, Nomen-Bausteine: -nis/-schaft/-tum), 5+5+4 units with short lessons and 56 items; a Wort-Bauen pool of 12; 19 badges; a Wörter-Zoo; a parents' cockpit ("Eltern"); a Schatzkiste progress screen.
- Daily training with a budget (50 answers/day, 10 per session, 5 new words per session), streak with a "shield", Meister-Check and a concept lifecycle (Lernpfad → Festigen → Meister-Check → Gold with refreshers).
- Audio: `audio/w_<slug>.mp3` (the noun) and `audio/a_<slug>.mp3` (article + noun), 350 each, 24 kHz mono, 8.4 MB in total; speech synthesis as fallback and for sentences. The 19 months/weekdays have no clips.

### 2.3 `wortregen.html` — Wort-Regen (card for all grades)

A Tetris-style gender game. It carries its own copy of the 350-word list (one long line, lines 170ff, categories partly out of date) and reads and **writes** the trainer's spaced-repetition records (`gram_srs_<name>`), so a game session changes the trainer's schedule. A "gentle" mode is hard-wired to the younger child.

### 2.4 Other files

- `sync.js` (472 lines): FamilySync, see 3.3.
- `audio/` 700 mp3.
- Not in git: `wireframe.html` (March design sketch), `.claude/launch.json` (local preview server), `.DS_Store`. There is no `.gitignore`, no README, no CLAUDE.md, no tests, no GitHub Actions.

---

## 3. How the pieces fit together

### 3.1 The three pages

```
index.html  ──?profil=<name>──►  grammatik.html   ◄──gram_srs_<name>──►  wortregen.html
   │                                   │                                       │
   └──────────────── all three load sync.js (FamilySync) ───────────────────────┘
                                       │
                         Firestore  families/<family code>/stores/<key>
```

- `index.html` is the entry point: profile picker → platform grid → module → topic picker → quiz → results; plus a history screen, a parents' dashboard and an in-app question editor. Cards for the trainer and the game navigate to the other page with `?profil=<name>` (line 1524).
- `grammatik.html` and `wortregen.html` accept that parameter only if the name is in **their own** hard-coded profile list; otherwise they fall back to a remembered profile or the first child. They are complete, independent apps with their own CSS, screens, scheduler and profile picker. They never come back to `index.html` except through the browser.
- Each page has its own `safeLoad`/`safeSave`/`showScreen`/`goHome` etc. Six function names exist in both `index.html` and `grammatik.html`; the date, shuffle and SRS-update helpers are duplicated under different names.

### 3.2 Inside `index.html` (8,644 lines)

| Lines | What |
|---|---|
| 8–784 | CSS for everything (platform, four module themes, quiz, dashboard, editor) |
| 785–1333 | HTML for 9 screens; profile cards with the names as static HTML |
| 1334–3001 | Script 1: state, storage helpers, `PROFILES`, navigation, module registry `EDITOR_MODULES` (1855), editor (2094–2690), custom profiles, topic picker |
| 3007–4012 | Script 2: `TOPICS`, mascots, the empty water bank `QB`, quiz engine (renderers 3159, checking 3553/3623), results, history, hash IDs (3895), SRS (3971) |
| 4018–4981 | Script 3: water questions pushed into `QB`, then `assignQuestionIds` |
| 4987–8642 | Script 4: `QB_BOOK`, `QB_MAGNETISM`, whale drawings, `QB_WHALES`, **and the start-up code** (8627–8641: ID migration, custom profiles, editor overrides, `FamilySync.init`) |

All scripts share one global scope. Five functions are declared twice (`showScreen`, `startQuiz`, `retryWeak`, `nextQuestion`, `renderHistory`); the later declaration wins silently.

### 3.3 `sync.js` — FamilySync

- Local first: the app only ever reads and writes `localStorage`. FamilySync pulls once at load (and when the tab becomes visible again, at most once a minute), pushes dirty keys 5 s after a change, and flushes with `keepalive` when the page is hidden.
- Transport: Firestore REST, no SDK, no login. Address: `families/<family code>/stores/<storage key>`; each document holds `{json, ts, deleted}`. The family code comes once from `?familie=…`, is stored under `family_sync_id`, and is immediately removed from the address bar.
- Only keys matching a rule list (lines 39–52) are synced. Each rule has a merge strategy: "more progress wins" for SRS entries, field-wise maximum for counters, union for sets and history, per-topic newest for editor banks, highest for high scores. Deletions leave tombstones so they propagate.
- The Firebase project id and the web API key are in the file (public by design; the only protection is the Firestore rules plus the secret path). The rules themselves are not in the repository and were not reviewed.
- Backup parachute: export/import of all synced keys as a JSON file.

### 3.4 Updates on the iPad

No service worker, no manifest, no cache-busting on `index.html` or `sync.js`. `grammatik.html` has a "self-healing" check (`APP_VERSION = 13`, line 985): it fetches itself with `no-store`, and reloads with `?v=N` if the server copy is newer — which drops the `?profil=` parameter.

---

## 4. Profiles

- `index.html` hard-codes three profiles (lines 1370–1375): the two children with avatar and grade, and "Eltern" (grade `null`). Their cards are static HTML (809–828). "Custom profiles" can be added with a `prompt()` and are stored device-locally in `custom_profiles` (not synced), always with grade `null`.
- `grammatik.html` (954–958) and `wortregen.html` (176–180) each hard-code the two children again (no grades; the game adds a per-child mode). Custom profiles do not exist there.
- The chosen profile is **not remembered** by `index.html` (every load starts at the picker); the trainer remembers `gram_lastProfile`. A bug: the trainer saves it JSON-quoted and the game reads it raw, so the game's fallback always lands on the first child.
- Grade only filters the platform grid; no content is filtered by grade.
- "Eltern" is just a profile: the dashboard and the editor are open to every profile, with no gate.
- **The display name is the storage key**: `wq_<Name>`, `gram_srs_<Name>`, `wr_high_<Name>` … Renaming a profile would orphan its data. A name with a space would not sync its round history (rule 51 requires `\S+`).

---

## 5. Spaced repetition and the daily training

Two implementations, same entry shape `{b: box, due: 'YYYY-MM-DD', s: seen, r: right, w: wrong, k: streak}`:

| | `index.html` (quizzes) | `grammatik.html` (nouns, grammar) |
|---|---|---|
| Intervals (days) | `[0,1,2,4,7,14]`, 6 boxes | `[0,1,2,4,8,16,32,64,90]`, 9 boxes, ±1 day fuzz |
| Right first try | box +1, `k`+1 | same |
| Right on retry / wrong | box −1, `k`=0 | same |
| Leech | 4+ wrong: interval × 0.6, min 2 days; `w` never decays | same |
| "Mastered" | — | box ≥ 3; typed answers after 3 right in a row |
| Session | 10 questions from one topic or all: due cards weakest first, then unseen, then not-yet-due as filler. No daily cap, no new-card limit, no streak. | 10 per session, 50/day goal, 5 new per session, 10 new per day, no new words while >20 reviews are due; at most 4 grammar slots; streak + shield |
| Beyond cards | `retryWeak` ignores SRS (random from topics < 70 %) | Concept lifecycle: Lernpfad → Festigen (≥ 3 days) → Meister-Check (10 q, 8 right first try, 2-day retry) → Gold, refreshers at 7/14/30/60 days; Akkusativ unlocks at 30 mastered words, Dativ after Akkusativ Gold |

Dates use UTC day strings (`toISOString`), so the "day" flips at 01:00/02:00 German time.

The quizzes identify a card by `qContentHash` (3895): a hash over `type|question|statement|prefix|suffix`, prefixed with module and topic (`wal_arten-h1a2b3c`). Twins get an `x` appended in array order. Any change to those fields creates a new card and leaves the old progress orphaned; a one-time migration from positional IDs exists (`migrateStatsIds`, 3926).

---

## 6. Where progress is stored — the migration contract

Every key below must keep its exact name and shape (or be migrated with a tested converter) so the children's progress survives. `<P>` is the profile's display name as typed in the code today.

| Key | Written by | Holds | Cloud merge rule |
|---|---|---|---|
| `wq_<P>` | index | last 10 rounds `[{date 'D.M.YYYY', time, mode, pct, module, topics:{t:{pts,max}}}]` | union, sorted, last 10 (`mergeHistory`) — only if `<P>` has no spaces |
| `wq_stats_<P>` | index | per question `{shown, correct, wrong, lastSeen}` | field-wise max |
| `wq_srs_<P>` | index | per question `{b,due,s,r,w,k}` | more progress wins |
| `wq_editor_QB`, `wq_editor_QB_book`, `_magnetism`, `_whales` | index editor | full copies of edited topics incl. ids and SVG, `__meta.topics[t].ts` | per topic, newer timestamp wins |
| `wq_editor_QB…_ver` | index | schema stamp `'2026-03-15-v3'` | never synced |
| `wq_deck_*` | legacy, no longer written | — | union (rule still present) |
| `custom_profiles` | index | `[{name, avatar}]` | **not synced** (device-local) |
| `gram_srs_<P>` | trainer **and** game | per noun `{b,due,s,r,w,k}` | more progress wins |
| `gram_days_<P>` | trainer | per day `{a,c,n,m,ms,sess,v,g}` | field-wise max |
| `gram_case_<P>` | trainer | per case `{a,c,gErr,cErr,bothErr}` | field-wise max |
| `gram_badges_<P>` | trainer | `{badgeId: date}` | union |
| `gram_path_<P>` | trainer | per course `{unit, passed, fest, mc, gBox, gDue}` | field-wise max — **shallow**, nested objects are not merged |
| `gram_lastProfile`, `gram_sound_on`, `gram_it_on` | trainer | device settings | never synced |
| `wr_high_<P>` | game | number | highest wins |
| `wr_stats_<P>` | game | per session metrics, last 60 | union |
| `wr_sound` | game | `'0'`/`'1'` raw | never synced |
| `family_sync_id` | sync.js | **the family code** | never synced, never in the repo |
| `family_sync_meta`, `family_sync_tombstones` | sync.js | last-seen timestamps, deletions | bookkeeping |
| sessionStorage `gram_healed` | trainer | update guard | — |

Cloud side: one Firestore document per key under `families/<code>/stores/`. Any redesign that keeps these key names and shapes and the same rule list needs **no data migration at all**, on the devices or in the cloud.

Two known data-format wrinkles to keep in mind: round dates are unpadded (`5.3.2026`) while the sync's sort expects `dd.mm.yyyy`, so cross-device history order can be wrong; and `gram_path`'s shallow merge can let one device keep an older Meister-Check state.

---

## 7. What is fragile

**Structure**
- One file, one scope: content, engine, CSS and start-up in `index.html`; the start-up code sits at the end of the script that also holds three content banks. A single syntax error in any bank disables book, magnetism, whales, the ID migration, custom profiles **and the cloud sync**.
- Five functions declared twice; six names shared between pages with different bodies; three copies of the word list / profile list / SRS logic across pages.
- Water is wired differently from the other modules (empty `QB` filled by `push`, topic list in three places, several hard-wired water leftovers: hero screen, droplets, editor options, "Klasse 3" text).

**Content ↔ engine coupling**
- IDs derived from wording (section 5): any spelling fix to a question text, statement, prefix or suffix orphans its progress.
- "The answer" is stored six different ways depending on type (string, string list, boolean, index, order list, `answer`). mcq options render as raw HTML while multiselect escapes them. 16 whale questions are generated by functions, not data.
- The in-app editor stores full topic copies that **override** the shipped bank whenever they are at least as long, synced to all devices. Fixes in the code stay invisible on a device that once edited that topic; bumping `QB_SCHEMA_VERSION` wipes every family edit; the stamp has not been bumped since March although magnetism and whales were added later. JSON import is not validated. Content from the cloud is rendered as HTML.

**Profiles and personal data**
- Names and grades in code and in storage keys (sections 4, 8). The older child's name is shown as the speaker ("… sagt:") in all 49 true/false questions, for every profile.

**Sync**
- The merge of `gram_path` is shallow; history dates unpadded; `custom_profiles` is device-local while its data syncs; `safeLoad` deletes a corrupt key without a tombstone (the cloud revives it).
- Firestore rules unknown; a web API key in the repo is normal, but the rules should at least forbid listing `families`.

**iPad / Safari**
- No cache-busting on `index.html`/`sync.js`; the self-heal reload in the trainer drops the profile parameter.
- Audio clips start inside timers and create a new `Audio()` each time, with no unlock step; failures fall back silently to the device voice, so a broken clip is never noticed.
- `100vh` layouts, nine `alert/confirm/prompt` dialogs, duplicate SVG ids across mascots.

**Confirmed small bugs**
- Filtered history is immediately re-rendered unfiltered (3809/3038). Dashboard shows raw IDs for magnetism and whales (1763). Home shows the last score of any module (1424). History cap of 10 across all modules starves the progress dots. Wort-Regen's word list lacks the months/days and 59 "abstrakt" nouns are mis-categorised; `CAT_LABELS` lacks "abstrakt" so those nouns never appear in the Zoo. `UNLOCK_DAT = 70` only drives a badge, not access. Stale comments in several places.

---

## 8. Personal data

### 8.1 In the current files (kind of data and where)

| Kind | Where |
|---|---|
| Both children's first names | `index.html` 809–821, 855, 1144, 1370–1375, 1604, 2029, 2040, 2979, 3248; `grammatik.html` 914, 931, 955–956, 3048, 3094; `wortregen.html` 177–178, 692 |
| Older child's name as speaker in question stems | all 49 true/false questions (`"… sagt?"` and `_it`), 4710–4711 scenario, editor default 2234–2239 |
| Name + school project (lapbook title, "her drawings") | `index.html` 6672–6673, 7084–7085, 7129–7130 (also the exact date of a school test) |
| Grades and school-year start (age can be inferred) | `index.html` 1371–1373, comments 6101, 7128; `grammatik.html` 503 (federal state, grade level) |
| Learning pace / study time / practice device of the older child | `grammatik.html` 961–966, 981–982 |
| Younger child's need for a "gentle" mode | `wortregen.html` 177–178, 228, 356 |
| Names in example sentences (one mentions a brother) | `grammatik.html` 914, 931, 2005–2007, 2062, 2131–2134, 2291 |
| Family language (Italian) | implied throughout by the `_it` fields |

Not found: surnames, school name, teacher, town, birthdays, photos, phone numbers, e-mail addresses (none in any revision of the four files). The vocabulary lists contain ordinary words only.

### 8.2 In the git history

- **Every commit.** The first names have been in `index.html` since the initial commit `62d2d64` (7 March 2026), so every one of the 67 commits contains them in its file tree; 36 commits add or change lines with the names. A clean history therefore means rewriting all commits, not a few.
- **Commit messages** naming a child or her grade: `274cc52`, `22acfc1`, `3070f8c`, `7d5034b`.
- **Author identity:** 37 commits carry `<account>@<computer>.local` as e-mail (identifies the Mac and the account name); 30 carry the Gmail address. Both would be visible after any rewrite that keeps the authors.
- **Files that ever existed:** only `index.html`, `grammatik.html`, `wortregen.html`, `sync.js` and `audio/*.mp3`. No photos, PDFs, worksheets or notes were ever committed.
- **Secrets:** the family code never appears in any commit (checked all revisions for the URL parameter and the storage key). The Firebase project id and web API key are present since `2a7ae87`.

### 8.3 Outside git but public or risky

- The **GitHub repository description** names both children (visible to anyone on the repository page; changed in GitHub settings, not in git).
- **`.claude/settings.local.json`** in the project folder on the Mac (git-ignored by a global rule, never committed) contains the family code inside old permission entries (Firestore URLs) and paths naming the children's school folders. It should be cleaned; note that it was printed once in this session's tool log while checking it.
- GitHub keeps commits reachable by their hash for a while after a force push (and in any fork or cache). A full clean-up needs a request to GitHub Support to purge the old objects, or the acceptance of that residual exposure.

---

## 9. Licences and third-party material (public repository)

| Material | Finding |
|---|---|
| Mascots (Tropfi, Zacki, Ferro, Walli), cycle diagram, whale drawings | Hand-coded SVG paths; the whale sheets mirror the layout of a school worksheet (7 whales A–G with lengths, 7 numbered body parts) but are marked "Eigene Zeichnung" and look original |
| "Der Krokodildieb" | No passages copied; questions paraphrase plot and characters (~29 KB) |
| School booklets / lapbooks | ~18 whale "Welches Wort fehlt?" sentences are probably word-for-word from the booklet's word list; one English lapbook sentence quoted; magnetism paraphrases an English lapbook |
| Voice clips (700 mp3) | Generated with a neural TTS voice (commit messages name the service and voice); no generator script, no licence note; redistribution terms unclear |
| Google Fonts (Nunito) | Loaded from Google's servers on every page; easy to self-host |
| Firebase | Free tier; config public by design |

For the states module (map, monument pictures) the brief's requirement stands: Wikimedia Commons material with a per-file credit line, or own drawings. A `content/ATTRIBUTION.md` (or a `credit` field per asset) would make this routine.

---

## 10. What a target structure could look like

Goal: the same app for the children, built so that content, engine and games are separate, checkable and extendable — and so that the states module is "one more data pack and one more engine", not another 3,000-line page. No build step: GitHub Pages serves static files, and ES modules + `fetch` of JSON work in iPad Safari. (Opening `index.html` from the Finder would no longer work; the existing local preview server in `.claude/launch.json` is the way.)

```
learning-platform/
  index.html                 thin shell → app/main.js
  grammatik.html             thin shells that open the right module with the same
  wortregen.html             ?profil=… so the iPad bookmarks keep working
  app/
    core/     storage.js (every key name in ONE place), sync.js (today's logic, unchanged
              key rules), profiles.js, srs.js (one scheduler, intervals per module),
              session.js (daily budget, filler, Meister-Check), audio.js (one channel,
              iOS unlock), router.js, i18n.js (de/it toggle)
    ui/       screens and components (profile picker, grid, results, dashboard, editor)
    engines/  quiz/ (the 8 question types as small renderers + one answer checker)
              gender-trainer/ (Ella: cases, Lernpfad, Zoo)
              word-rain/
              map-quiz/ (NEW: highlight → pick 1 of 3, tap, type; works for any map pack)
  content/
    schema/   question.schema.json, noun.schema.json, map-pack.schema.json, module.json
    water/ book/ magnetism/ whales/ nouns/   one JSON file per topic, with explicit ids
    states/   germany.json (16 regions: name, capital, aliases, neighbours, look-alikes,
              fun fact, picture + credit), germany.svg (map with one path per state)
    ATTRIBUTION.md
  assets/     audio/ (as today), maps/, pictures/ (each with licence/credit)
  tools/      validate-content.mjs, freeze-ids.mjs (one-off: copies today's hash ids
              into the JSON so progress keys stay valid), check-pii.mjs, smoke test
  tests/      srs, merge rules, answer checker, id stability (node --test, no framework)
  docs/       STOCKTAKE.md, DESIGN.md, MIGRATION.md, CONTENT-AUTHORING.md
  CLAUDE.md   the rulebook (no personal data, no secrets, key registry is law, commit style,
              how to add a topic from a worksheet photo, what to run before pushing)
  README.md, .gitignore, .github/workflows/check.yml
```

Design points behind it:

- **Content as data with a schema.** One answer model for all types (`answer: {kind, value}`), explicit `id` per question (today's hash ids frozen in, so no progress is lost; new ones assigned when authoring), `source` metadata without personal references, translations as sibling fields. The validator refuses a commit with a missing answer, an option that is not in the list, a duplicate id, an unknown type, or a forbidden string.
- **Profiles come from the device and the family sync, not the code.** A first-run screen ("Wer lernt hier?") creates profiles with name, avatar, grade and options like the gentle mode; the list is stored under a new synced key (e.g. `family_profiles`) so a device that opens the family link gets both children. The storage keys keep today's `<P>` so nothing moves. The code ships no names.
- **One spaced-repetition engine** with intervals per module (quizzes keep `[0,1,2,4,7,14]`, nouns keep the 9-box list, so no due dates change), one daily scheduler shared by all modules, one audio channel.
- **The map-quiz engine** takes a map pack: an SVG with one `path` per region and a JSON with the facts. Skills per region: name-pick3 → name-tap → name-type, and capital-pick3 → capital-find-state → capital-type. Each region × skill is a card in the SRS; a card climbs the ladder after correct answers and drops a rung after a mistake. Distractors come from neighbours and look-alikes. Small regions get an enlarged tap target or a zoom on the phone; typing compares exact spelling (umlauts, hyphens) and shows where the word differs. The same engine takes Europe or rivers later.
- **Editor becomes a proposal tool**, not an override: edits are exported as JSON for review and commit, instead of silently replacing shipped content family-wide. (Existing `wq_editor_*` data is read once and offered for export.)
- **Checks that run by themselves:** `node tools/validate-content.mjs`, `node --test`, a PII/secret scan (the forbidden-word list lives outside the repo, e.g. in the vault, and the tool reads it if present), and a headless smoke test that opens the app, picks a profile and answers one question of each type. The same checks run in a GitHub Action on every push (free for public repositories) and as a local pre-commit hook.
- **Updates:** versioned module URLs (`main.js?v=…` from a tiny `version.json`) so the iPad never runs a stale engine with new content.
- **New topics from worksheet photos:** photo → draft JSON (by Claude) → validator → preview in the app on the local server → commit. The school archive stays outside the repository; the `source` field says "class worksheet, Sept 2026", never a child's name.

---

## 11. Migration principles (what must not change)

1. The three URLs keep working; the family link keeps working; the family code stays only in `family_sync_id`.
2. Every key in section 6 keeps its name and shape; `sync.js` keeps its rule list and merge functions (additions allowed, changes to existing rules only with a test).
3. Today's question ids are frozen into the content files; a test proves that the ids generated from the JSON equal the ids the live app generates for the same questions.
4. The SRS intervals per module stay identical, so no card becomes due earlier or later.
5. The switch happens by merging to `main` only after the checks pass, a side-by-side test with a copy of one device's data (export/import parachute), and Andrea's yes. The old files are moved to `legacy/`, not deleted, and removed later.
6. The history rewrite comes last, after a full backup (bundle + the GitHub description change), with Andrea's explicit yes at that step.

---

## 12. Open questions for the design

1. **History clean-up:** rewrite all 67 commits with the names replaced (keeps the story) — or start the public history fresh with one clean commit and keep the old history in a private backup (simplest, least to go wrong)? Either way: force push, change the repository description, and a request to GitHub Support to purge old objects.
2. **Where the names live:** per device with a first-run screen, shared through the family sync so each device shows both children — and keep today's names as the storage keys so no data moves? (The names then exist only in the family's own data, never in the repository.)
3. **Which modules must stay playable:** water, Krokodildieb and magnetism are last year's (grade 3) topics — keep them as an archive on the grid, or retire them (progress kept, cards hidden)?
4. **One app or three pages:** merge Ella and Wort-Regen into the one shell with one scheduler (old bookmarks keep working), or keep them as separate pages that only share modules?
5. **Licence stance** for the public repository: reword the booklet sentences, self-host the font and regenerate the voice clips with a clearly licensed voice — or accept as is? And for the states module: Commons photos with credit lines, or own simple drawings?
