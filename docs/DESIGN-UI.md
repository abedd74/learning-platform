# Look and feel — design brief for v2

Date: 18 October 2026. Status: **decided — direction B "Stille See"** (Andrea, 18 Oct, no tweaks for now); mock in `docs/design-mock/index.html`, tokens in `app/ui/theme.css`. Phase 3 builds every screen from the chosen direction's tokens (`app/ui/theme.css`).

## What today's screens do, seen on an iPad

- Three apps, three looks: a violet platform grid, a teal/yellow "Deutsch mit Ella", a plain system-font Wort-Regen. Nothing ties them together.
- Laid out for a phone, then left-aligned on the iPad: everything sits in the top third, the rest of the screen is empty white.
- The child sees developer vocabulary: "Alle Klassen / Klasse 1–4" pills, "Frageeditor", "Sachunterricht".
- Emoji do the work of icons and illustrations everywhere, in different sizes and styles.
- Each module brings its own loud colour (teal, green, sky blue, violet) — the app has no colour of its own.
- The question screen's structure is good (progress, mascot with a speech bubble, question card, 2×2 answers) but small and thin; feedback and explanations compete for space.
- Ella's home is a column of eight buttons; the important one ("Tägliches Training") is one of many.

## Goals

1. **A first impression**: opening the app should feel like arriving somewhere calm and friendly — one atmosphere, a soft horizon, the child's own avatar, their name.
2. **One obvious thing to do**: the home screen offers *one* big button for today's training (the planner decides what's in it) and shows at a glance what is waiting and the streak. Modules and games sit below as a second layer.
3. **Intuitive for a 7- and a 10-year-old on a touch screen**: big targets (≥ 56 px), few words, one action per screen, no dialogs, the back way always visible.
4. **Calm**: a quiet base palette with one accent; motion that reassures (a card settles in, a right answer glows) and never flashes; sound optional.
5. **Consistent**: every screen from the same tokens — colours, type scale, spacing, radii, shadows — so a new module looks like it was always there.
6. **iPad first, iPhone fine**: content centred in a column of at most ~680 px; one column on the phone; the map module gets the full width.

## Structure shared by both directions

- **Welcome** — the horizon, the app name small, "Wer bist du?" and large avatar discs with names. "Eltern" as a small text link at the bottom. (On a device with one profile this screen is skipped.)
- **Home** — greeting with avatar; a "Heute" card: what waits today ("12 Karten warten · 5 neue · Wale und Deutsch"), the streak with the week strip, and the one big button "Los geht's". Below: "Deine Themen" tiles (mascot, name, small progress ring) and "Spiele". Archive modules sit in a folded "Letztes Jahr" row. Footer: version and sync, tiny.
- **Question** — top bar: close, progress segments, counter; mascot small beside a speech bubble; the question card centred; answers as big tiles (2 columns on the iPad, 1 on the phone); after an answer the tile turns green or amber, and a sheet rises with the explanation and "Weiter".
- **Results** — a large ring with the score, a kind headline, the mascot, three small facts (new, reviewed, streak), "Nochmal" and "Fertig".
- Eltern mode (dashboard, snapshots, errors, export) uses the same tokens with a denser, tabular layout.

## Direction A — "Morgenlicht"

Warm. Cream-to-peach sky with a low sun and soft hills on the horizon. Ink is a warm dark brown; the accent is apricot-coral; success is sage green. Display type: Fredoka (rounded, friendly, upright); body: Nunito. Cards are white with a warm, soft shadow and 24 px corners.

## Direction B — "Stille See"

Cool and still. Pale mint-blue sky over a calm lake with gentle waves and two small stars. Ink is a deep teal-navy; the accent is lake teal; the warm note is sand (used for the streak and for "new"). Display type: Quicksand; body: Nunito. Cards are white, airy, 20 px corners, a faint teal shadow.

Both keep the mascots (Walli, Ella the owl, Tropfi, Zacki, Ferro), redrawn in phase 3 in one line style; in the mock they are emoji placeholders.

## Not in scope of the mock

The map module screen (phase 7) and Eltern mode are described, not mocked; they follow the chosen tokens.
