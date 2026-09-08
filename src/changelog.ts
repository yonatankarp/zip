/*
 * The changelog, written for players rather than for me.
 *
 * This file is the single source of truth: CHANGELOG.md at the repo root is
 * generated from it by tools/make-changelog.js, and a test fails if the two
 * fall out of step. Entries correspond to things that actually reached the
 * deployed site, not to every commit.
 */
export type ChangeKind = 'added' | 'changed' | 'fixed';

export interface Change {
  kind: ChangeKind;
  text: string;
}

export interface Release {
  version: string;
  /** ISO date, UTC. */
  date: string;
  /** One line on what the release was about. */
  summary: string;
  changes: Change[];
}

/** Newest first. */
export const RELEASES: Release[] = [
  {
    version: '1.7.0',
    date: '2026-09-08',
    summary: 'The clock starts when you see the board, not when you first move.',
    changes: [
      { kind: 'changed', text: 'A board now arrives covered, with a Start button and a 3-2-1 count-in. The clock starts the instant it is revealed, so studying a puzzle before the timer runs is no longer free. Space or Enter starts it too.' },
      { kind: 'changed', text: 'A covered board draws nothing but its grid — you can see what size you are getting and no more.' },
      { kind: 'fixed', text: 'Updates now show up straight away. The page was being served from a cache for up to ten minutes after a release, which is how the last one appeared to be missing.' }
    ]
  },
  {
    version: '1.6.0',
    date: '2026-09-08',
    summary: 'The daily is now reproducible for good, and this page exists.',
    changes: [
      { kind: 'added', text: 'This changelog, reachable from the version number below the board.' },
      { kind: 'fixed', text: 'A given day now always produces the same board. It was generated from the same settings the practice tiers use, so retuning those would quietly have changed every past daily.' },
      { kind: 'fixed', text: 'A tab left open across midnight now picks up the new day instead of serving yesterday’s board forever. A run already in progress is left alone to finish.' },
      { kind: 'changed', text: 'Saved results and part-finished runs carry a version, so future changes can migrate them rather than misread them.' }
    ]
  },
  {
    version: '1.5.0',
    date: '2026-09-08',
    summary: 'Playable with a screen reader, installable, and playable offline.',
    changes: [
      { kind: 'added', text: 'Screen-reader support: the board announces every move, and its label carries the live state.' },
      { kind: 'added', text: 'Install it to your home screen and play with no connection.' },
      { kind: 'added', text: 'A 30-day history strip under the daily, with your best and median times.' },
      { kind: 'fixed', text: 'Visible focus rings for keyboard players, and arrow keys no longer hijacked from the rest of the page.' },
      { kind: 'fixed', text: 'Text contrast now meets 4.5:1 throughout — white on the blue button was well below it.' },
      { kind: 'fixed', text: 'Reloading mid-solve no longer hands you a clean board and a fresh clock.' },
      { kind: 'changed', text: 'Puzzle generation moved off the main thread, so building a hard board no longer stutters the one on screen.' }
    ]
  },
  {
    version: '1.4.0',
    date: '2026-09-08',
    summary: 'Sharing that goes where you actually share.',
    changes: [
      { kind: 'added', text: 'Sharing a result opens your phone’s share sheet, and still copies to the clipboard everywhere else.' },
      { kind: 'added', text: 'Pasting the link now shows a preview card with a real board on it.' }
    ]
  },
  {
    version: '1.3.0',
    date: '2026-09-08',
    summary: 'A daily puzzle, and boards that look like the real thing.',
    changes: [
      { kind: 'added', text: 'A daily puzzle: the same board for everyone, with a streak that stands until you miss a day.' },
      { kind: 'added', text: 'Backtracks are counted and reported alongside your time.' },
      { kind: 'added', text: 'Share your result as a line of text.' },
      { kind: 'changed', text: 'Harder puzzles now carry far more numbers and far fewer walls — Expert went from 5 numbers behind 18 walls to 15 numbers behind 6. They are harder as well as denser.' }
    ]
  },
  {
    version: '1.2.0',
    date: '2026-09-07',
    summary: 'Rebuilt underneath; nothing to see.',
    changes: [
      { kind: 'changed', text: 'Rebuilt on React and TypeScript. The board itself is still drawn by hand, because that is what keeps dragging smooth.' }
    ]
  },
  {
    version: '1.1.1',
    date: '2026-09-07',
    summary: 'The clock belongs to the puzzle.',
    changes: [
      { kind: 'fixed', text: 'Restarting no longer resets the timer, so a run going badly cannot be wiped to protect a best time.' }
    ]
  },
  {
    version: '1.1.0',
    date: '2026-09-07',
    summary: 'Stop losing your work, and a proper finish.',
    changes: [
      { kind: 'fixed', text: 'A stray movement across an earlier part of the line no longer erases everything after it. The line only retracts by retracing it.' },
      { kind: 'added', text: 'A solve now sets off a real celebration, and beating your best sets off more of one.' }
    ]
  },
  {
    version: '1.0.1',
    date: '2026-09-07',
    summary: 'Quieter by default.',
    changes: [
      { kind: 'changed', text: 'Sound starts off. The speaker button cycles every step, numbers and wins only, or silent.' }
    ]
  },
  {
    version: '1.0.0',
    date: '2026-09-07',
    summary: 'First release.',
    changes: [
      { kind: 'added', text: 'Four difficulties, every puzzle randomly generated with exactly one solution.' },
      { kind: 'added', text: 'Difficulty measured by how often a solver is genuinely left with a choice, rather than guessed from the number count.' },
      { kind: 'added', text: 'Hints that point out the next move, and reset the board if it can no longer be finished.' },
      { kind: 'added', text: 'Timer, best time per difficulty, and auto-next for continuous practice.' }
    ]
  }
];

export const CURRENT_VERSION = RELEASES[0]!.version;
