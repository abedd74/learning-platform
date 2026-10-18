# Credits and licences

The repository is public. Everything shipped with the app is listed here: what is our own work, and what comes from elsewhere under which terms. New third-party material (maps, pictures, fonts, sounds) gets a line before it is committed.

## Own work

| What | Where | Notes |
|---|---|---|
| Questions, hints, explanations, lessons, word lists | `content/` | Written for this app. Some topics follow class material: the children's book *Der Krokodildieb* (questions about the plot; no text from the book), lapbooks on magnetism, a class booklet on whales and dolphins (sentences reworded, not copied). |
| Whale drawings | `assets/figures/whales/*.svg` | Drawn for this app as simple vector shapes. Their arrangement (seven whales, numbered body parts) follows a class worksheet; the artwork is our own. |
| Mascots (Tropfi, Zacki, Ferro, Walli) and the water-cycle diagram | app code | Drawn for this app as simple vector shapes. |

## Third-party

| What | Where | Source | Licence |
|---|---|---|---|
| Pronunciation clips (700 files: `w_<word>.mp3` the noun, `a_<word>.mp3` article + noun) | `audio/` | Generated in July–August 2026 with the neural text-to-speech voice "de-DE-KatjaNeural" (Microsoft), through the open-source `edge-tts` tool. | **Not yet confirmed.** The service's terms may not allow redistributing generated audio. If they do not, the clips are regenerated with a voice whose licence allows it (same file names, no code change). Tracked in `docs/DECISIONS.md`. |
| Fonts Quicksand (v37) and Nunito (v32), variable, latin and latin-ext subsets | `assets/fonts/` | Google Fonts (downloaded 18 Oct 2026); the old pages still load Nunito from Google until the switch | SIL Open Font License 1.1 — `OFL-Quicksand.txt`, `OFL-Nunito.txt` next to the files |
| Emoji | — | Drawn by the device's own emoji font; nothing is shipped | — |

## Planned

- **German federal states module:** a map of the 16 states and one picture per state from Wikimedia Commons, each with author, licence and link in this file and a credit line in the app.
