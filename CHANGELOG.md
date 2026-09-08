# Changelog

Generated from `src/changelog.ts` by `tools/make-changelog.js` — edit that, not this.

## 1.8.0 — 2026-09-08

The line is wider, and its colour tells you how far through you are.

### Changed

- The line is thicker, and shifts from blue through violet to pink as the board fills, so how far through you are is readable at a glance. Numbers you have passed through take the line’s colour there.
- The number you are heading for is ringed in the colour the line will be when it arrives — a different colour each time, rather than a fixed highlight.

## 1.7.0 — 2026-09-08

The clock starts when you see the board, not when you first move.

### Changed

- A board now arrives covered, with a Start button and a 3-2-1 count-in. The clock starts the instant it is revealed, so studying a puzzle before the timer runs is no longer free. Space or Enter starts it too.
- A covered board draws nothing but its grid — you can see what size you are getting and no more.

### Fixed

- Updates now show up straight away. The page was being served from a cache for up to ten minutes after a release, which is how the last one appeared to be missing.

## 1.6.0 — 2026-09-08

The daily is now reproducible for good, and this page exists.

### Added

- This changelog, reachable from the version number below the board.

### Changed

- Saved results and part-finished runs carry a version, so future changes can migrate them rather than misread them.

### Fixed

- A given day now always produces the same board. It was generated from the same settings the practice tiers use, so retuning those would quietly have changed every past daily.
- A tab left open across midnight now picks up the new day instead of serving yesterday’s board forever. A run already in progress is left alone to finish.

## 1.5.0 — 2026-09-08

Playable with a screen reader, installable, and playable offline.

### Added

- Screen-reader support: the board announces every move, and its label carries the live state.
- Install it to your home screen and play with no connection.
- A 30-day history strip under the daily, with your best and median times.

### Changed

- Puzzle generation moved off the main thread, so building a hard board no longer stutters the one on screen.

### Fixed

- Visible focus rings for keyboard players, and arrow keys no longer hijacked from the rest of the page.
- Text contrast now meets 4.5:1 throughout — white on the blue button was well below it.
- Reloading mid-solve no longer hands you a clean board and a fresh clock.

## 1.4.0 — 2026-09-08

Sharing that goes where you actually share.

### Added

- Sharing a result opens your phone’s share sheet, and still copies to the clipboard everywhere else.
- Pasting the link now shows a preview card with a real board on it.

## 1.3.0 — 2026-09-08

A daily puzzle, and boards that look like the real thing.

### Added

- A daily puzzle: the same board for everyone, with a streak that stands until you miss a day.
- Backtracks are counted and reported alongside your time.
- Share your result as a line of text.

### Changed

- Harder puzzles now carry far more numbers and far fewer walls — Expert went from 5 numbers behind 18 walls to 15 numbers behind 6. They are harder as well as denser.

## 1.2.0 — 2026-09-07

Rebuilt underneath; nothing to see.

### Changed

- Rebuilt on React and TypeScript. The board itself is still drawn by hand, because that is what keeps dragging smooth.

## 1.1.1 — 2026-09-07

The clock belongs to the puzzle.

### Fixed

- Restarting no longer resets the timer, so a run going badly cannot be wiped to protect a best time.

## 1.1.0 — 2026-09-07

Stop losing your work, and a proper finish.

### Added

- A solve now sets off a real celebration, and beating your best sets off more of one.

### Fixed

- A stray movement across an earlier part of the line no longer erases everything after it. The line only retracts by retracing it.

## 1.0.1 — 2026-09-07

Quieter by default.

### Changed

- Sound starts off. The speaker button cycles every step, numbers and wins only, or silent.

## 1.0.0 — 2026-09-07

First release.

### Added

- Four difficulties, every puzzle randomly generated with exactly one solution.
- Difficulty measured by how often a solver is genuinely left with a choice, rather than guessed from the number count.
- Hints that point out the next move, and reset the board if it can no longer be finished.
- Timer, best time per difficulty, and auto-next for continuous practice.
