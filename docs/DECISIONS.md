# Decisions

One dated line per decision: what was decided, by whom, and where the detail lives. Newest at the bottom. Decisions are changed by adding a new line, never by editing an old one.

- 2026-10-18 — Redesign before the next module (federal states and capitals). Andrea.
- 2026-10-18 — The repository stays public; every personal detail leaves the code and later the history ("option A"). Andrea.
- 2026-10-18 — Public history restarts with one clean commit; the old history is kept as a private backup on the Mac. Andrea, on the builder's recommendation (STOCKTAKE §12, DESIGN §11).
- 2026-10-18 — Profiles (name, avatar, grade, options) come from the device and the family sync, never from the code; storage keys keep today's names so no progress moves. Andrea (DESIGN §3).
- 2026-10-18 — Last year's modules (water cycle, Der Krokodildieb, magnetism) stay playable as an archive. Andrea.
- 2026-10-18 — One app with one scheduler, one planner and one audio channel; `grammatik.html` and `wortregen.html` become forwarders so bookmarks keep working. Andrea (DESIGN §2).
- 2026-10-18 — Licences: booklet sentences reworded when moved to data, font self-hosted, voice clips kept with a source note, Wikimedia Commons pictures with credit lines for the states module. Andrea.
- 2026-10-18 — Thorough build: card = item × skill, one tested scheduler with a 90-day simulation, a planner across modules with a test-date mode, daily cloud snapshots with restore, a synced error log and a visible version, staging under `/next/` on the real iPad, Safari-engine smoke tests, a rulebook and this log. Andrea (DESIGN §4–§10).
- 2026-10-18 — No build step and no runtime dependencies; Node only for tools and tests; Playwright pinned to 1.63.0 for the smoke test (releases younger than two weeks are skipped). Builder.
- 2026-10-18 — The forbidden-word list for the personal-data check lives on the Mac outside the repository (`~/.config/lernplattform/pii-words.txt`), so the names never enter the repository, not even inside the check. Builder.
- 2026-10-18 — The Lernpfad state key (`gram_path_<P>`) is merged with the deep field-wise-maximum rule instead of the old flat one, so units passed or Meister-Check tries on two devices are both kept. The deep rule equals the flat one on flat entries (tests/merges.test.mjs pins the regression case). Builder, per DESIGN §7.
