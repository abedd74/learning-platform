# Content

Everything the children learn lives here as data. The engine (`app/`) never contains questions, words or lessons. Every file is checked by `tools/validate-content.mjs` (run by `npm run check`, the pre-commit hook and the GitHub check).

Rules (also in `CLAUDE.md`):
- No personal data: no child's name, school, teacher or town. True/false statements are spoken by the module's mascot.
- A question's `id` never changes once written. Progress hangs on it (`docs/MIGRATION.md`).
- Reword school material instead of copying it; third-party pictures and maps need a free licence and a line in `ATTRIBUTION.md`.

## A quiz module

```
content/<module>/module.json
content/<module>/<topic>.json      one file per topic: { "items": [ …questions… ] }
```

`module.json`:

| Field | Meaning |
|---|---|
| `id` | the folder name (`whales`) |
| `name`, `subject` | `{de, it?}` |
| `icon` | one emoji |
| `grades` | e.g. `[4]` |
| `archive` | `true` for last year's modules (shown folded on the home screen) |
| `engine` | `"quiz"` |
| `mascot` | `{key, name}` — who speaks in the module |
| `idPrefix` | prefix of every question id (`wal_`; the water module has none, kept from the old app) |
| `legacyStorageKey` | the old in-app editor's key for this module (read once, never written) |
| `srs.intervals` | days per box; quizzes use `[0,1,2,4,7,14]` |
| `topics` | `[{id, label:{de,it?}, icon, file}]` in display order |
| `cycleSteps` | water only: the six steps of the cycle per language |

## A question

Common fields: `id`, `type`, `prompt {de, it?}`, optional `hint`, `explain` (shown after answering), `media {figure}` (an SVG under `assets/`), `answer`. Texts are `{de, it?}`; Italian is shown under the German when the device has it switched on.

| `type` | `answer` |
|---|---|
| `choice` | `{options:[{de,it?}], correct: <index>}` |
| `multi` | `{options:[…], correct:[<index>, …]}` |
| `bool` | `{statement:{de,it?}, correct: true|false}` — the mascot says the statement |
| `text` | `{prefix:{de,it?}, suffix:{de,it?}, accepted:["…"], exact?: true}` — lenient matching unless `exact` |
| `order` | `{items:[…], correct:[<index>, …]}` — the right order as indexes into `items` |
| `pairs` | `{pairs:[{left:{de,it?}, right:{de,it?}}]}` |
| `image` | `{options:[{emoji, label:{de,it?}}], correct:<index>}` |
| `cycle` | `{lang:"de"|"en", gapStep:<0-5>, options:[…], correct:<index>}` — the right option is the missing step |

New ids: `<idPrefix><topic>-<short-slug>` (e.g. `wal_arten-pottwal-zahnwal`); never reuse an old one.

## The noun pack (Deutsch mit Ella, Wort-Regen)

```
content/nouns/pack.json         intervals and the file list
content/nouns/nouns.json        { "items": [ {de, g, pl, it, itG, em, cat, obl?, rule?} ] }
content/nouns/categories.json   { <cat>: {label:{de}, icon} }
content/nouns/templates.json    { akk: [ {t:"… %A %N.", it, cats?|only?|also?} ], dat: […] }
content/nouns/path-<k>.json     { units: [ {n, title, lessonHtml, items?:[pmcq|pfill]} ] }
content/nouns/wortbau.json      { items: [pfill] }
```

A noun's card id is the noun itself (`"Apfel"`), so a noun's spelling never changes. `g` is `der`, `die` or `das`. Lessons may use only `p, b, i, em, strong, span, div, br, small, u` with `class` and `style`. The last unit of a course has no items (its questions are built live).
