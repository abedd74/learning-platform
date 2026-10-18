# CLAUDE.md — rules for working on the Lernplattform

This repository is a learning app used every day by two primary-school children on an iPad and an iPhone, published with GitHub Pages from `main`. **Pushing to `main` publishes to the children.** The repository is public.

The owner is not a developer. Explain in plain words, keep messages short (often read on a phone), and ask before anything that leaves the Mac.

## 1. Never

- Never push, force-push, open a PR, change GitHub settings or deploy Firestore rules without the owner's explicit yes for that step.
- Never put personal data in the repository: no children's names, ages, grades tied to a person, school, teacher, town, photos, learning notes about a child, e-mail addresses, machine names. This includes code, comments, content, test fixtures, commit messages and file names. Speakers in questions are the module mascots, never a child. The `source` of content names the material ("Arbeitsblatt Wale, Sept 2026"), never a person.
- Never put the family code (the `?familie=` secret) anywhere: not in the repository, a log, a message, a test or a screenshot. Do not open or print the stored value (`family_sync_id`).
- Never `git add -A`, `git add .`, `git commit -a`, `--no-verify`, `git reset --hard`, `git clean`, bare `git stash`, or force-push (the one agreed history clean-up excepted, after a backup and the owner's yes).
- Never delete files: move them aside (`legacy/`) and remove them in a later, separate commit once nothing uses them.
- Never change the name or shape of an existing storage key, or an existing merge rule in `sync.js`, without a migration and a test (§3).
- Never change a question's `id` once it is in a content file.

## 2. Always

- Work on a branch or worktree. Every step is its own small commit with a clear message; stage files by name.
- Run `npm run check` before every commit (the pre-commit hook does it; enable once with `git config core.hooksPath tools/hooks`).
- New content goes into `content/` as data that passes `tools/validate-content.mjs`; never into engine code.
- Record decisions as one dated line in `docs/DECISIONS.md`.
- Third-party material (maps, pictures, fonts, audio) needs a free licence and a line in `content/ATTRIBUTION.md` (file, source URL, author, licence).

## 3. Progress data is sacred

The children's progress lives in `localStorage` on each device and is mirrored to Firestore by the family sync (key by key, with merge rules). The contract is `docs/MIGRATION.md`; the registry is `app/core/storage.js` (the only place that may spell a key name); the merge rules are `app/core/merges.js`. A test keeps the document and the registry equal.

- Existing keys keep their exact names and shapes. New data goes into new keys, added to the registry and, if synced, to the rule list in `sync.js` with a merge function and a property test.
- Profile names are part of today's key names (`wq_srs_<P>`, `gram_srs_<P>` …). They come from the device and the family sync at runtime — never from the code.
- Spaced-repetition intervals per module stay as they are, so no card becomes due earlier or later.
- Before anything is switched live: a backup export from a device, the checks green, a test on the real iPad under `/next/`, and the owner's yes.

## 4. Layout

See `docs/DESIGN.md` §2. In short: `index.html` (shell), `app/core` (storage, sync, srs, planner, profiles, audio, errors, time), `app/engines` (quiz, ella, wordrain, mapquiz), `app/ui`, `content/` (JSON per topic + schemas), `assets/`, `tools/`, `tests/`, `docs/`.

Until the switch, the live app is the old single-file pages (`index.html`, `grammatik.html`, `wortregen.html`, `sync.js`). Do not edit them except for an agreed hotfix; they are replaced at the switch and then moved to `legacy/`.

## 5. Adding a topic from worksheet photos

1. The owner shares photos or PDFs from the school archive (outside the repository).
2. Draft one topic file in `content/<module>/<topic>.json` following `content/schema/`; reword sentences instead of copying booklet text; `source` names the material, not a person.
3. `npm run check` until green; preview with `npm run serve` and the module in the app.
4. Commit the topic alone. Push only with the owner's yes.

## 6. Commands

- `npm run serve` — local server on http://localhost:8765/
- `npm run check` — validator, unit tests, personal-data scan
- `npm run smoke` — browser test in WebKit (Safari's engine)
- `npm run dump-ids` — one-off: golden list of the question ids of the old app

## 7. Model use

Core logic (scheduler, planner, sync merges, storage registry), the switch and the history clean-up deserve the strongest model available; mechanical work (content extraction, porting screens) can use a cheaper one, checked by the tests.
