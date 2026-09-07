# Zip

A playable clone of LinkedIn's *Zip* with a generator that produces random,
guaranteed-solvable puzzles in four difficulties — built for speed training.

The whole game is one static `index.html` — no build step, no dependencies, no
network requests. Open the file, or serve the directory as-is.

```
open index.html        # play locally
./test/all.sh          # everything below
node test/verify.js    # 500 generated puzzles per tier, all invariants
node test/play.js      # interaction rules
node test/ui.js        # the UI under a DOM stub, driven through its own handlers
node test/render.js    # the page in real headless Chrome, driven by real input
```

## Deploying

`.github/workflows/deploy.yml` runs the full suite on every push to `main` and
publishes to GitHub Pages only if it passes. Set **Settings → Pages → Source**
to **GitHub Actions** once; there is nothing to build, so the deploy job just
uploads the repository as-is.

`.nojekyll` keeps Pages from running the files through Jekyll. The page pulls no
fonts, scripts, or images from anywhere, so it also works offline, from
`file://`, and on any other static host.

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

2. **Constrain until unique.** Count solutions (capped at 2). If a rival solution
   exists it must use some edge the intended path does not — walling that edge
   kills the rival and provably cannot invalidate the intended path. Walls are
   the cheap constraint so they go in first; numbers are added only when the wall
   budget runs out. This is what makes generation practical: with randomly placed
   numbers alone, *zero* of 120 sampled 7×7 grids were uniquely solvable. With
   adaptive walls the yield is 100% at every size.

3. **Measure the difficulty, don't assume it.** "Fewer numbers = harder" is
   directionally true but varies wildly inside a tier, which is exactly what
   ruins a speed-training app. Instead a solver walks the solution applying only
   inference a human has available — forced moves, connectivity (would this
   strand a region?), dead-end detection, and parity — and counts the positions
   where it is genuinely left with a choice. That count is the difficulty, and
   tiers are bands on it. Puzzles outside the band are rejected or given another
   number until they land in it.

## Tiers

| Tier   | Grid | Decision points | ~walls | ~numbers | gen time |
|--------|------|-----------------|--------|----------|----------|
| Easy   | 5×5  | 0–2             | 4      | 7        | 2 ms     |
| Medium | 6×6  | 3–6             | 6      | 7        | 7 ms     |
| Hard   | 7×7  | 7–11            | 10     | 6        | 38 ms    |
| Expert | 8×8  | 12+             | 18     | 6        | 185 ms   |

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
index.html     the entire game: engine + UI, two inline scripts
.nojekyll      tell GitHub Pages to serve the files verbatim
test/load.js   pulls the inline scripts out of index.html for the tests
test/verify.js generator invariants: legality, uniqueness, difficulty band
test/play.js   interaction rules: start, walls, number order, revisits
test/ui.js     the page under a DOM stub: hit testing, drag, keys, win
test/browser.js  a ~120-line CDP driver: launch, emulate, input, screenshot
test/render.js real headless Chrome: renders in both themes, real mouse input
test/all.sh    runs all four
```

The first inline script is the engine — generation, solving and difficulty
measurement, with no DOM dependency. The tests extract and run that exact script
rather than a parallel copy, so there is nothing that can drift out of sync with
what the browser loads.

`test/ui.js` runs `index.html`'s own scripts under a small hand-rolled DOM
stub and drives the real `pointerdown`/`pointermove` handlers with coordinates
derived from the SVG viewBox, so hit testing, rendering, the timer and the win
path all actually execute. Drags are replayed aiming at cell centres *and* 2%
inside each corner — the corner aims are the ones that would catch a hit test
that mis-registers against the board's padding.

`test/render.js` covers what a stub cannot: it drives real headless Chrome over
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
