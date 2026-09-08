# Zip

An independent, from-scratch implementation of the puzzle idea behind
LinkedIn's *Zip*. Not affiliated with, endorsed by, or connected to LinkedIn;
no code or assets are taken from it. MIT licensed — see `LICENSE`.


A playable clone of LinkedIn's *Zip* with a generator that produces random,
guaranteed-solvable puzzles in four difficulties — built for speed training.

React + TypeScript, built with Vite. The engine is a plain framework-free
module; React owns the chrome and never the board.

```
npm install
npm run dev            # play locally with hot reload
npm run build          # typecheck, then bundle to dist/
./test/all.sh          # everything below
node test/verify.js    # generated puzzles per tier, all invariants
node test/play.js      # interaction rules
node test/daily.js     # date rollover, seeding, storage versioning, streaks
node test/changelog.js # release data, and CHANGELOG.md in step with it
node test/render.js    # the built app in real Chrome, driven by real input
```

## Architecture

The split that matters is **engine / core / chrome**, not the framework:

- `src/engine/zip.ts` — generation, solving and difficulty measurement. No DOM,
  no React, no imports. Node runs it directly (it strips the types), so the
  engine suites need no build and cannot drift from what the app bundles.
- `src/game/` — the game itself: rules, input, timing, animation. Also
  framework-free. `board.ts` draws the SVG **imperatively**, because drawing
  runs on every `pointermove` and every animation frame — a finished board plus
  a celebration is several hundred attribute writes per frame. That is a
  mutation workload, not a reconciliation one, so React hands the `<svg>` over
  by ref and never touches its contents.
- `src/components/` — React: header, tiers, controls, status, banner, progress.
  Everything that is genuinely a function of state.

The core publishes a snapshot to React **at most once per animation frame**, so
however fast the pointer moves, the chrome re-renders at a human rate and the
drag path stays free of React entirely.

## Deploying

`.github/workflows/deploy.yml` runs the full suite on every push to `main` and
publishes `dist/` to GitHub Pages only if it passes. Set **Settings → Pages →
Source** to **GitHub Actions** once.

`public/.nojekyll` keeps Pages from running the output through Jekyll. The page
still pulls no fonts, images, or scripts from any other host.

## Daily and practice

**Daily** is one shared board per UTC date — the same puzzle for everyone,
straight from the seeded generator, with no server involved. The result is
recorded once (replaying does not overwrite it), a streak counts consecutive
days and stands until a day is actually missed, and the result copies to the
clipboard as a share line:

```
Zip #250 — 0:41.3
↩ 3 backtracks · 🔥 5 day streak
https://yonatankarp.com/zip/
```

**Practice** is the endless generator with the four difficulty tiers, auto-next,
and best times.

Sharing uses the **Web Share API** where the browser has one, so on a phone the
result goes straight to the native sheet — Messages, WhatsApp, Slack, whatever
you actually use — and falls back to the clipboard everywhere else. Dismissing
the sheet copies nothing, because dismissing is a decision rather than a
failure. There are deliberately **no per-network share buttons**: they reach one
place each, and prefilled text survives the trip unreliably, so a "share to X"
button tends to post a bare link with none of your result. Copy-and-paste is
also the pattern that actually spread.

`tools/make-og.js` renders `public/og.png`, the card that shows when the link is
pasted. The board in it is not a mock-up: the real app is loaded, a real puzzle
part-solved, and its `<svg>` lifted out into the card layout, so the card cannot
drift from the game. Re-run it after a visual change. Note that `og:image` must
be an absolute URL, which pins the deployed origin in `index.html`.

Both modes count **backtracks** — single-square retractions — the way the
original reports them. It is a better measure of a run than time alone, because
it counts how much you guessed.

## Accessibility

The board is an `<svg>` mutated by hand, which assistive technology cannot
follow, so it is marked decorative and the accessible interface sits around it:
a focusable `role="application"` region whose label carries the live state
("14 of 36 squares filled, heading for number 5"), described by the rules and
the keys, with a polite live region announcing every move ("Row 3, column 4,
number 2 of 8"). The progress bar is a real `progressbar`. Focus rings are
`:focus-visible` so keyboard users see where they are without pointer users
getting a ring on every click.

Arrow keys are only claimed when the board or nothing has focus — previously
they were taken page-wide, which stopped scrolling and hijacked focused
controls.

Text contrast is asserted in the suite at 4.5:1 for body text, secondary text
and the primary button, in both themes. That check immediately failed three
ways, including white on the blue button at 3.25:1; the line colour and the
button colour are now separate tokens, because a blue that reads well as a
26 px stroke is too light to carry white text.

## Installing and offline

`public/manifest.webmanifest` plus a service worker make it installable to a
home screen and playable with no network. The worker caches at runtime rather
than precaching a build manifest: navigations are network-first so a deploy is
never hidden behind the cache, and hashed assets are cache-first because their
names change whenever their contents do. Icons are rendered from the same mark
as the header by `tools/make-icons.js`.

## Releases

`src/changelog.ts` is the single source of truth for what shipped when.
`CHANGELOG.md` is generated from it by `tools/make-changelog.js`, and
`test/changelog.js` fails if the two drift, so they cannot quietly disagree.
The in-app page opens from the version number below the board, or directly at
`#changelog` — a fragment rather than a route, so it is linkable and closable
with Back without needing a router or a second HTML file on a static host.

Entries are written for players. A test rejects any that read like commit
messages, because that is the direction this kind of file always rots in.

Version numbers map to **deploys, not commits**: several early commits went out
in a single push and were never separately live.

## The rules

Draw one continuous path that visits **every** cell exactly once, starting at
**1**, ending at the highest number, taking the numbers in ascending order, and
never crossing a wall.

## How puzzles are generated

Generation runs backwards: start from a guaranteed-valid solution, then add
constraints until it is the *only* solution.

1. **Sample the solution path.** A random Hamiltonian path via *backbite* — begin
   with a snake path covering the grid, then repeatedly take an endpoint, pick a
   random grid-neighbour of it, and reverse the tail after that neighbour. Every
   move preserves a valid Hamiltonian path, so it can never fail. Random DFS was
   the obvious alternative but is heavily biased toward boundary-hugging snakes,
   which makes every puzzle feel the same.

2. **Constrain until unique.** Drop the tier's full complement of numbers on the
   path, then count solutions (capped at 2). If a rival solution exists it must
   use some edge the intended path does not — walling that edge kills the rival
   and provably cannot invalidate the intended path. Walls are spent only on the
   ambiguity the numbers leave behind. Both levers are needed: with randomly
   placed numbers and no walls at all, *zero* of 120 sampled 7×7 grids were
   uniquely solvable.

3. **Measure the difficulty, don't assume it.** "Fewer numbers = harder" is
   directionally true but varies wildly inside a tier, which is exactly what
   ruins a speed-training app. Instead a solver walks the solution applying only
   inference a human has available — forced moves, connectivity (would this
   strand a region?), dead-end detection, and parity — and counts the positions
   where it is genuinely left with a choice. That count is the difficulty, and
   tiers are bands on it. Puzzles outside the band are rejected or given another
   number until they land in it.

## Tiers

| Tier   | Grid | Decision points | ~numbers | ~walls | gen time |
|--------|------|-----------------|----------|--------|----------|
| Easy   | 5×5  | 1–4             | 6        | 4      | 1 ms     |
| Medium | 6×6  | 5–8             | 8        | 5      | 2 ms     |
| Hard   | 7×7  | 9–13            | 12       | 5      | 13 ms    |
| Expert | 8×8  | 14+             | 15       | 6      | 64 ms    |

Numbers are the primary constraint and walls are spent only on the ambiguity
that remains. An earlier version had it the other way round, which was cheaper
to generate but produced boards nothing like the original: five numbers fenced
in by eighteen walls. Putting numbers first gives a dense, lightly-walled board
*and* a harder one — fewer walls means more freedom, so measured decision points
went up as the number count did — and it made generation three times faster,
because numbers prune the search better than walls.

The next puzzle is generated in the background while you play the current one,
so there is no wait between puzzles.

## Solver pruning

Exhaustive solution counting on an 8×8 grid is only tractable with good pruning.
Three checks, cheapest first:

- **Parity** — the grid is bipartite on `(row + col) % 2`, so the remaining cells
  must alternate colours starting opposite the path head. That pins both colour
  counts *and* the colour of the final cell. Very cheap, kills large branches.
- **Connectivity** — flood-fill the unvisited region from the head; if anything
  is unreachable, the branch is dead.
- **Degree** — every remaining cell needs two open sides to be passed through
  (one if it is where the path terminates).

## Playing

Drag from **1**. The line only ever retracts by retracing it — dragging back
over the previous square removes that one step. Touching some earlier part of
the line does nothing, deliberately: letting the head jump backwards meant one
careless sweep of the mouse could erase most of a board. Arrow keys move the
head, <kbd>U</kbd> undoes a step, <kbd>R</kbd> restarts, <kbd>N</kbd> generates a
new puzzle.

A few things exist specifically for drilling speed:

- **Hint** (<kbd>H</kbd>) points out the next move. Because the puzzle has
  exactly one solution, any path that can still be finished must be a prefix of
  it — so the same check answers both "what next" and "am I already lost". If
  the line has gone somewhere unfinishable, the board resets and the hint shows
  the opening move instead of pretending the position is recoverable. A hinted
  solve still counts for the session but never sets a record.
- **Auto-next** loads the next puzzle 1.8 s after a solve, so a session is a
  continuous run rather than a click between every rep. Toggle it off if you
  would rather study the finished board.
- The **next number you are heading for is ringed**, so you are not re-scanning
  the grid for it between every segment.
- The line **follows the pointer continuously** instead of advancing a cell at a
  time. Cell-at-a-time drawing makes a fast drag feel like stamping segments;
  here the line reaches up to half a cell past the last committed square — which
  is exactly where the next square commits — so the handover is seamless in both
  directions, and it eases home on release rather than snapping. Pushing at a
  wall gives slightly, so a blocked direction feels like resistance rather than
  a dead control.
- Numbers **recolour to the path** as you pass through them, so the line reads as
  continuous instead of vanishing behind a disc, and progress is visible at a
  glance.
- The solve is timed to a tenth, the **best time per difficulty** persists in
  `localStorage`, and a finished solve reports how far off your best it was.
  **The clock belongs to the puzzle, not the attempt**: Restart clears the board
  but never the time, and the clock keeps running while the board sits empty, so
  a run going badly cannot be wiped to protect a best. Only a new puzzle starts a
  new clock.
  A per-session **solve count and average** sits under the board.

And some things purely because they make a run feel better:

- **Sound, off by default.** The speaker button cycles *every step → numbers and
  wins → off*, and the choice persists. Turned on, each step clicks at a pitch
  that rises as the board fills, so a run has a shape you can hear; numbers ring
  brighter as you reach them; a solve resolves into a chord, with an extra note
  on a personal best. It is synthesised from oscillators, so the page still ships
  as one file with no assets. Nothing makes noise — and no audio context is even
  built — until you ask for it.
- **Haptics** on phones, on each number and on the solve.
- A reached number **swells briefly**, and finishing sends a **bright dash
  running the length of the completed route**, then a **burst of confetti** —
  about a hundred pieces on an ordinary solve and two and a half times that when
  a personal best falls, thrown in waves from the finishing square and the
  corners of the board so it reads as a cascade rather than one puff. It plays in
  a fixed full-viewport layer, so it is not boxed in by the board. Both the sweep
  and the burst are pure overlays: if their frames never run, nothing is lost.
- A **streak** counter for consecutive solves, which a reveal resets.

Theme follows the system and can be pinned light or dark with the button in the
header.

## Layout

```
index.html          Vite entry
src/engine/zip.ts   generation, solving, difficulty measurement (no DOM)
src/game/core.ts    rules, input, timing, snapshots for React
src/game/source.ts  puzzles from a worker, or directly if there is none
src/game/generate.worker.ts
src/changelog.ts    release notes, the source of truth for CHANGELOG.md
src/game/board.ts   imperative SVG renderer
src/game/fx.ts      the celebration layer
src/game/audio.ts   oscillator sound
src/components/     React chrome
test/verify.js      generator invariants: legality, uniqueness, difficulty band
test/play.js        interaction rules: start, walls, number order, revisits
test/browser.js     a small dependency-free CDP driver
test/serve.js       static server for dist/ (ES modules cannot load over file://)
test/render.js      the built app in real Chrome: rendering, input, everything
test/all.sh         runs all three
test/calibrate.js   difficulty sweep; run when tier shapes change, not in CI
tools/make-og.js    regenerates the link-preview card from the live renderer
tools/make-icons.js regenerates the app icons from the header mark
public/sw.js        runtime-caching service worker
```

Generation runs in a **Web Worker**. An Expert board takes ~60 ms on a laptop
and several times that on a phone, which is long enough to drop frames on the
board still on screen. If the browser has no worker the same call runs directly
after yielding a frame, so nothing depends on it.

There is one UI suite now, and it drives the same bundle that gets deployed.
The old DOM-stub suite existed because there was no browser available; a stub
cannot host React, and a real browser is strictly better evidence anyway, so its
coverage moved into `test/render.js` rather than being dropped.

`test/render.js` drives real headless Chrome over
the DevTools protocol (no Puppeteer — `test/browser.js` is a small dependency-free
driver built on Node's built-in `WebSocket`), checks the page renders without
console errors in both colour schemes, that the layout never scrolls horizontally
at any width from 320 px to 1024 px, and that the two routes to a light palette —
the `prefers-color-scheme` block and the pinned `[data-theme="light"]` block —
resolve to identical tokens, since those lists are declared twice and could
otherwise drift. It then solves a puzzle with genuine mouse input, waits for
auto-next to advance the board, and measures the drawing itself: easing the
pointer across one cell must move the tip of the line through many small
positions rather than one jump (before the line followed the pointer it managed
2 positions and a 100-unit jump; it now takes 13 with a largest step of 8), and a
single fast event spanning a straight run must commit every cell under it. It
skips itself if Chrome is not installed.

Move legality during play comes from `engine.canStep()` — the UI does not
restate the rules — and a finished solve is checked with `engine.validate()`
against the rules rather than compared to the stored solution, so a generator
bug cannot reject a legitimate solve.
