# Lernplattform

A small learning app for primary-school children, used at home on an iPad or iPhone. German first, with Italian translations. It runs entirely in the browser and is published with GitHub Pages.

What is inside:
- **Quiz modules** — water cycle, a children's book, magnetism, whales — with eight question types and spaced repetition.
- **Deutsch mit Ella** — articles (der/die/das), Akkusativ and Dativ, noun building, with recorded pronunciations.
- **Wort-Regen** — a falling-tiles game that practises the same words.
- **Coming:** a map quiz (German federal states and their capitals).

Progress is stored on each device (`localStorage`) and, optionally, mirrored between a family's devices through Firestore with a secret family link. No accounts, no analytics.

## Status

The app is being rebuilt so that content, engine and games are separate and checked automatically. The live app is unchanged until the switch; see [docs/DESIGN.md](docs/DESIGN.md) for the plan and [docs/STOCKTAKE.md](docs/STOCKTAKE.md) for the state before the rebuild.

## Run it locally

```bash
npm install
```

```bash
npm run serve
```

Then open http://localhost:8765/ in a browser. Opening the HTML file directly from the Finder is not supported (the app loads its content with `fetch`).

## Checks

```bash
npm run check
```

Runs the content validator, the unit tests and the personal-data scan. The same checks run on GitHub for every push. See [CLAUDE.md](CLAUDE.md) for the project rules.

## Credits

Third-party material and its licences are listed in `content/ATTRIBUTION.md` (added with the content files).
