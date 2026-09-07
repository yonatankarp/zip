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
node test/ui.js        # the real UI, driven through its own pointer handlers
```

## Deploying to GitHub Pages

`index.html` sits at the repository root, so Pages serves it with no build and
no workflow:

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)`.
3. It goes live at `https://<user>.github.io/<repo>/` within a minute or so.

`.nojekyll` is committed so Pages copies files verbatim instead of running them
through Jekyll. Nothing else is required — the page pulls no fonts, scripts, or
images from anywhere, so it works offline and over any static host.

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

## Controls

Drag from **1**. Dragging back over the previous cell undoes that step; tapping
any cell already on the path rewinds to it. Arrow keys move the head,
<kbd>U</kbd> undoes, <kbd>R</kbd> restarts, <kbd>N</kbd> generates a new puzzle.
Best time per difficulty is kept in `localStorage`.

## Layout

```
index.html     the entire game: engine + UI, two inline scripts
.nojekyll      tell GitHub Pages to serve the files verbatim
test/load.js   pulls the inline scripts out of index.html for the tests
test/verify.js generator invariants: legality, uniqueness, difficulty band
test/play.js   interaction rules: start, walls, number order, revisits
test/ui.js     the page itself under a DOM stub: hit testing, drag, keys, win
test/all.sh    runs all three
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

Move legality during play comes from `engine.canStep()` — the UI does not
restate the rules — and a finished solve is checked with `engine.validate()`
against the rules rather than compared to the stored solution, so a generator
bug cannot reject a legitimate solve.
