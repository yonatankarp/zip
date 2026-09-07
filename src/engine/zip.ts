/*
 * Zip engine: puzzle generation, uniqueness checking, difficulty measurement.
 *
 * A puzzle is a grid with numbered cells and walls. The solution is a single
 * path that visits every cell exactly once, starts at number 1, ends at the
 * highest number, hits the numbers in ascending order, and never crosses a
 * wall. Cells are indexed `row * cols + col`; wall pairs are always [min, max].
 *
 * Nothing here touches the DOM.
 */

/** A cell index: `row * cols + col`. */
export type Cell = number;
/** A blocked edge between two orthogonally adjacent cells, always [min, max]. */
export type Wall = [Cell, Cell];
export type Rng = () => number;
export type DifficultyName = 'easy' | 'medium' | 'hard' | 'expert';

export interface PuzzleStats {
  /** Positions where a solver applying full look-ahead still had a choice. */
  guesses: number;
  /** The same count for a solver applying only the immediate rules. */
  shallowGuesses: number;
  branchSum: number;
  maxBranch: number;
  longestForcedRun: number;
  guessAt: number[];
  waypointCount?: number;
  wallCount?: number;
  refineSteps?: number;
  attempts?: number;
}

export interface Puzzle {
  rows: number;
  cols: number;
  walls: Wall[];
  /** Cell of number 1, number 2, … in order. */
  waypoints: Cell[];
  solution: Cell[];
  difficulty?: DifficultyName;
  stats?: PuzzleStats;
}

export interface Difficulty {
  label: string;
  rows: number;
  cols: number;
  wallBudget: number;
  waypoints: number;
  maxWaypoints: number;
  minGuesses: number;
  maxGuesses: number;
}

export interface GenerateOptions {
  rows?: number;
  cols?: number;
  rng?: Rng;
  waypoints?: number;
  maxWaypoints?: number;
  wallBudget?: number;
  seedWalls?: number;
  minGuesses?: number;
  maxGuesses?: number;
  minGap?: number;
  maxRefineSteps?: number;
  maxAttempts?: number;
  mixIterations?: number;
}

// ------------------------------------------------------------------ random

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
}

// -------------------------------------------------------------------- grid

export function gridNeighbours(rows: number, cols: number): Cell[][] {
  const neighbours: Cell[][] = new Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const list: Cell[] = [];
      if (r > 0) list.push(i - cols);
      if (r < rows - 1) list.push(i + cols);
      if (c > 0) list.push(i - 1);
      if (c < cols - 1) list.push(i + 1);
      neighbours[i] = list;
    }
  }
  return neighbours;
}

function edgeKey(a: Cell, b: Cell): number {
  return a < b ? a * 65536 + b : b * 65536 + a;
}

/** Grid adjacency with walled edges removed. */
export function buildAdjacency(rows: number, cols: number, walls: readonly Wall[]): Cell[][] {
  const base = gridNeighbours(rows, cols);
  if (!walls.length) return base;
  const blocked = new Set(walls.map(([a, b]) => edgeKey(a, b)));
  return base.map((list, i) => list.filter(j => !blocked.has(edgeKey(i, j))));
}

// --------------------------------------------------------- path generation

/** Snake path: row 0 left-to-right, row 1 right-to-left, … Always valid. */
function boustrophedon(rows: number, cols: number): Cell[] {
  const path: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const c = r % 2 === 0 ? k : cols - 1 - k;
      path.push(r * cols + c);
    }
  }
  return path;
}

/*
 * Backbite: sample a Hamiltonian path by repeatedly re-hinging an endpoint.
 * Take the tail cell e, pick a random grid-neighbour u = p[i], then reverse
 * p[i+1..end]. The added edge is u-e and the dropped edge is p[i]-p[i+1], so
 * the result is always a valid Hamiltonian path -- the move can never fail.
 * Mixes far better than random DFS, which hugs the boundary and would make
 * every puzzle feel the same.
 */
export function backbite(rows: number, cols: number, rng: Rng, iterations?: number): Cell[] {
  const n = rows * cols;
  const neighbours = gridNeighbours(rows, cols);
  const path = boustrophedon(rows, cols);
  const at = new Int32Array(n);
  for (let i = 0; i < n; i++) at[path[i]!] = i;

  const rounds = iterations ?? Math.max(2000, n * 120);
  for (let t = 0; t < rounds; t++) {
    if (rng() < 0.5) {
      path.reverse();                       // work on the other endpoint
      for (let i = 0; i < n; i++) at[path[i]!] = i;
    }
    const end = path[n - 1]!;
    const candidates = neighbours[end]!;
    const pivot = at[candidates[(rng() * candidates.length) | 0]!]!;
    if (pivot >= n - 2) continue;           // no-op re-hinge

    let lo = pivot + 1;
    let hi = n - 1;
    while (lo < hi) {
      [path[lo], path[hi]] = [path[hi]!, path[lo]!];
      at[path[lo]!] = lo;
      at[path[hi]!] = hi;
      lo++;
      hi--;
    }
    if (lo === hi) at[path[lo]!] = lo;
  }
  return path;
}

/*
 * Walls only ever go on edges the solution does not use, so the intended path
 * stays valid no matter how many are added.
 */
export function pickWalls(
  rows: number, cols: number, path: readonly Cell[], count: number, rng: Rng
): Wall[] {
  if (count <= 0) return [];
  const used = new Set<number>();
  for (let i = 0; i + 1 < path.length; i++) used.add(edgeKey(path[i]!, path[i + 1]!));

  const neighbours = gridNeighbours(rows, cols);
  const free: Wall[] = [];
  for (let a = 0; a < neighbours.length; a++) {
    for (const b of neighbours[a]!) {
      if (a < b && !used.has(edgeKey(a, b))) free.push([a, b]);
    }
  }
  shuffle(free, rng);
  return free.slice(0, Math.min(count, free.length)).sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * Positions along the path to place numbers on. Always includes both endpoints;
 * minGap stops consecutive numbers landing on top of each other.
 */
export function pickWaypointIndices(
  n: number, k: number, rng: Rng, minGap = 2
): number[] | null {
  const want = Math.min(Math.max(k, 2), n);
  for (let attempt = 0; attempt < 60; attempt++) {
    const pool = shuffle(Array.from({ length: n - 2 }, (_, i) => i + 1), rng);
    const chosen = [0, n - 1];
    for (const candidate of pool) {
      if (chosen.length >= want) break;
      if (chosen.every(c => Math.abs(c - candidate) >= minGap)) chosen.push(candidate);
    }
    if (chosen.length === want) return chosen.sort((a, b) => a - b);
  }
  return null;
}

// ---------------------------------------------------------------- analysis

export interface Engine {
  readonly n: number;
  readonly adj: Cell[][];
  readonly numAt: Int32Array;
  readonly target: Cell;
  findSolutions(cap?: number): Cell[][];
  countSolutions(cap?: number): number;
  analyze(solution: readonly Cell[]): PuzzleStats;
  validate(path: readonly Cell[]): boolean;
  canStep(path: readonly Cell[], inPath: Uint8Array, cell: Cell): boolean;
}

/*
 * Shared machinery for the counting solver and the difficulty scorer.
 * Everything is preallocated and mutated in place; the search never allocates.
 */
export function makeEngine(puzzle: Puzzle): Engine {
  const { rows, cols } = puzzle;
  const n = rows * cols;
  const adj = buildAdjacency(rows, cols, puzzle.walls);
  const waypoints = puzzle.waypoints;
  const numberCount = waypoints.length;
  const target = waypoints[numberCount - 1]!;

  const numAt = new Int32Array(n);
  waypoints.forEach((cell, i) => { numAt[cell] = i + 1; });

  const colour = new Uint8Array(n);
  for (let c = 0; c < n; c++) colour[c] = (((c / cols) | 0) + (c % cols)) & 1;

  const visited = new Uint8Array(n);
  const freeByColour = new Int32Array(2);
  const stack = new Int32Array(n);
  const reached = new Int32Array(n);
  const mark = new Int32Array(n);
  const headAdj = new Int32Array(n);
  let stamp = 0;

  function reset(): void {
    visited.fill(0);
    freeByColour[0] = 0;
    freeByColour[1] = 0;
    for (let i = 0; i < n; i++) freeByColour[colour[i]!]++;
  }
  const visit = (cell: Cell) => { visited[cell] = 1; freeByColour[colour[cell]!]--; };
  const unvisit = (cell: Cell) => { visited[cell] = 0; freeByColour[colour[cell]!]++; };

  /*
   * Necessary conditions for the unvisited cells to admit a Hamiltonian path
   * from `head` to `target`. Cheapest checks first.
   */
  function feasible(head: Cell, remaining: number): boolean {
    if (remaining === 0) return head === target;
    if (visited[target]) return false;

    // Parity: the remaining cells alternate colours starting opposite head,
    // which pins both the colour counts and the colour of the final cell.
    const other = colour[head]! ^ 1;
    const wantOther = (remaining + 1) >> 1;
    if (freeByColour[other] !== wantOther) return false;
    if (freeByColour[colour[head]!] !== remaining - wantOther) return false;
    if (colour[target] !== (colour[head]! ^ (remaining & 1))) return false;

    const s = ++stamp;
    for (const w of adj[head]!) headAdj[w] = s;

    // Flood fill the unvisited region from head: everything must be reachable.
    let sp = 0;
    let seen = 0;
    for (const w of adj[head]!) {
      if (!visited[w] && mark[w] !== s) {
        mark[w] = s;
        stack[sp++] = w;
        reached[seen++] = w;
      }
    }
    if (sp === 0) return false;
    while (sp > 0) {
      const v = stack[--sp]!;
      for (const w of adj[v]!) {
        if (!visited[w] && mark[w] !== s) {
          mark[w] = s;
          stack[sp++] = w;
          reached[seen++] = w;
        }
      }
    }
    if (seen !== remaining) return false;

    // Degree: every remaining cell needs two open sides to be passed through
    // (one if it is where the path terminates).
    for (let i = 0; i < seen; i++) {
      const cell = reached[i]!;
      let degree = headAdj[cell] === s ? 1 : 0;
      for (const w of adj[cell]!) if (!visited[w]) degree++;
      if (degree < (cell === target ? 1 : 2)) return false;
    }
    return true;
  }

  /*
   * Is stepping onto `cell` legal given the path drawn so far? This is the
   * single source of truth for the rules during play -- the UI must not
   * restate them.
   */
  function canStep(path: readonly Cell[], inPath: Uint8Array, cell: Cell): boolean {
    if (cell < 0 || cell >= n) return false;
    if (path.length === 0) return cell === waypoints[0];
    if (inPath[cell]) return false;
    const head = path[path.length - 1]!;
    if (!adj[head]!.includes(cell)) return false;      // adjacent and not walled
    const number = numAt[cell]!;
    if (number === 0) return true;
    let next = 1;
    for (const c of path) if (numAt[c] !== 0) next++;
    return number === next;                            // numbers in ascending order
  }

  /** Enumerate solutions, stopping at `cap`. Two is enough to test uniqueness. */
  function findSolutions(cap = 2): Cell[][] {
    reset();
    const start = waypoints[0]!;
    visit(start);
    const found: Cell[][] = [];
    const current = new Int32Array(n);
    current[0] = start;

    const walk = (head: Cell, count: number, nextNumber: number): void => {
      if (count === n) {
        if (head === target && nextNumber > numberCount) found.push(Array.from(current));
        return;
      }
      if (!feasible(head, n - count)) return;
      for (const w of adj[head]!) {
        if (visited[w]) continue;
        const number = numAt[w]!;
        if (number !== 0 && number !== nextNumber) continue;
        visit(w);
        current[count] = w;
        walk(w, count + 1, number !== 0 ? nextNumber + 1 : nextNumber);
        unvisit(w);
        if (found.length >= cap) return;
      }
    };
    walk(start, 1, 2);
    return found;
  }

  const countSolutions = (cap = 2): number => findSolutions(cap).length;

  /*
   * Walk the intended solution and count how often a solver is genuinely stuck
   * for a choice. `guesses` applies full look-ahead (connectivity, dead ends,
   * parity); `shallowGuesses` applies only the immediate rules. Real difficulty
   * sits between the two, and `guesses` is the stable one to band on.
   */
  function analyze(solution: readonly Cell[]): PuzzleStats {
    reset();
    visit(solution[0]!);
    let nextNumber = 2;
    let guesses = 0;
    let shallowGuesses = 0;
    let branchSum = 0;
    let maxBranch = 0;
    let forcedRun = 0;
    let longestForcedRun = 0;
    const guessAt: number[] = [];

    for (let t = 0; t + 1 < n; t++) {
      const head = solution[t]!;
      const legal: Cell[] = [];
      for (const w of adj[head]!) {
        if (visited[w]) continue;
        const number = numAt[w]!;
        if (number !== 0 && number !== nextNumber) continue;
        legal.push(w);
      }
      if (legal.length > 1) shallowGuesses++;

      let survivors = 0;
      for (const w of legal) {
        visit(w);
        if (feasible(w, n - (t + 2))) survivors++;
        unvisit(w);
      }
      if (survivors > 1) {
        guesses++;
        branchSum += survivors - 1;
        maxBranch = Math.max(maxBranch, survivors);
        guessAt.push(t);
        longestForcedRun = Math.max(longestForcedRun, forcedRun);
        forcedRun = 0;
      } else {
        forcedRun++;
      }

      const next = solution[t + 1]!;
      visit(next);
      if (numAt[next] !== 0) nextNumber++;
    }
    longestForcedRun = Math.max(longestForcedRun, forcedRun);

    return { guesses, shallowGuesses, branchSum, maxBranch, longestForcedRun, guessAt };
  }

  /*
   * Structural check of an arbitrary path against the rules. A finished solve
   * is validated with this rather than compared to the stored solution, so a
   * generator bug cannot reject a legitimate solve.
   */
  function validate(path: readonly Cell[]): boolean {
    if (path.length !== n) return false;
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const cell = path[i]!;
      if (cell < 0 || cell >= n || seen[cell]) return false;
      seen[cell] = 1;
      if (i > 0 && !adj[path[i - 1]!]!.includes(cell)) return false;
    }
    let expect = 1;
    for (const cell of path) {
      const number = numAt[cell]!;
      if (number !== 0) {
        if (number !== expect) return false;
        expect++;
      }
    }
    return expect === numberCount + 1 && path[0] === waypoints[0] && path[n - 1] === target;
  }

  return { n, adj, numAt, target, findSolutions, countSolutions, analyze, validate, canStep };
}

// -------------------------------------------------------------- generation

/*
 * Generate by refinement rather than by luck.
 *
 * Sample a path, drop the tier's full complement of numbers on it, then
 * repeatedly ask "is this puzzle ambiguous?". If a rival solution exists it
 * must use some edge the intended path does not -- walling that edge kills the
 * rival and provably cannot invalidate the intended path.
 *
 * Numbers come first and walls second, which is the way round the real game
 * reads: a hard board is dense with numbers, not fenced into corridors. Walls
 * are then spent only on the ambiguity that remains, and more numbers are added
 * beyond the target only if the wall budget runs out first.
 *
 * With randomly placed numbers alone and no walls at all, zero of 120 sampled
 * 7x7 grids were uniquely solvable, which is why both levers are needed.
 */
interface RefineConfig {
  /** How many numbers the finished puzzle should carry. */
  waypoints: number;
  maxWaypoints: number;
  wallBudget: number;
  seedWalls: number;
  minGuesses: number;
  maxGuesses: number;
  minGap: number;
  maxRefineSteps: number;
}

export function refine(
  path: Cell[], rows: number, cols: number, rng: Rng, cfg: RefineConfig
): Puzzle | null {
  const n = rows * cols;
  const indices = pickWaypointIndices(n, cfg.waypoints, rng, cfg.minGap);
  if (!indices) return null;

  const used = new Set<number>();
  for (let i = 0; i + 1 < path.length; i++) used.add(edgeKey(path[i]!, path[i + 1]!));

  // A few seed walls still help the first solve terminate quickly on the large
  // grids; the bulk of the constraining is done by the numbers.
  const walls = pickWalls(rows, cols, path, Math.min(cfg.seedWalls, cfg.wallBudget), rng);

  function addWaypoint(): boolean {
    if (indices!.length >= cfg.maxWaypoints) return false;
    const pool: number[] = [];
    for (let i = 1; i < n - 1; i++) {
      if (indices!.every(chosen => Math.abs(chosen - i) >= cfg.minGap)) pool.push(i);
    }
    if (!pool.length) return false;
    indices!.push(pool[(rng() * pool.length) | 0]!);
    indices!.sort((a, b) => a - b);
    return true;
  }

  const build = (): Puzzle => ({
    rows, cols,
    walls: walls.map(w => [w[0], w[1]] as Wall),
    waypoints: indices!.map(i => path[i]!),
    solution: path.slice()
  });

  for (let step = 0; step < cfg.maxRefineSteps; step++) {
    const puzzle = build();
    const engine = makeEngine(puzzle);
    const solutions = engine.findSolutions(2);
    if (solutions.length === 0) return null;       // over-walled; should not happen

    if (solutions.length > 1) {
      // Wall an edge used by a rival solution but not by the intended one.
      const rival = solutions.find(s => s.some((cell, i) => cell !== path[i])) ?? solutions[1]!;
      const options: Wall[] = [];
      for (let i = 0; i + 1 < rival.length; i++) {
        const a = rival[i]!;
        const b = rival[i + 1]!;
        if (!used.has(edgeKey(a, b))) options.push(a < b ? [a, b] : [b, a]);
      }
      if (walls.length < cfg.wallBudget && options.length) {
        walls.push(options[(rng() * options.length) | 0]!);
        walls.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
        continue;
      }
      if (addWaypoint()) continue;
      return null;                                 // out of levers
    }

    const stats = engine.analyze(path);
    // Too hard: another number constrains it further. Too easy: numbers only
    // ever make a puzzle easier, so this path is spent -- resample.
    if (stats.guesses > cfg.maxGuesses) {
      if (addWaypoint()) continue;
      return null;
    }
    if (stats.guesses < cfg.minGuesses) return null;

    puzzle.stats = {
      ...stats,
      waypointCount: indices!.length,
      wallCount: walls.length,
      refineSteps: step
    };
    return puzzle;
  }
  return null;
}

export function generate(options: GenerateOptions = {}): Puzzle | null {
  const rows = options.rows ?? 6;
  const cols = options.cols ?? 6;
  const rng = options.rng ?? mulberry32((Math.random() * 4294967296) >>> 0);
  const wallBudget = options.wallBudget ?? 8;
  const cfg: RefineConfig = {
    waypoints: options.waypoints ?? 4,
    maxWaypoints: options.maxWaypoints ?? 10,
    wallBudget,
    // Just enough to keep the first solve quick on the big grids; the
    // numbers, not the walls, are what make the puzzle well-posed.
    seedWalls: options.seedWalls ?? Math.min(2, wallBudget),
    minGuesses: options.minGuesses ?? 0,
    maxGuesses: options.maxGuesses ?? Infinity,
    minGap: options.minGap ?? 2,
    maxRefineSteps: options.maxRefineSteps ?? 40
  };

  const maxAttempts = options.maxAttempts ?? 300;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const path = backbite(rows, cols, rng, options.mixIterations);
    const puzzle = refine(path, rows, cols, rng, cfg);
    if (puzzle) {
      puzzle.stats!.attempts = attempt + 1;
      return puzzle;
    }
  }
  return null;
}

// ------------------------------------------------------------------- tiers

/*
 * Bands on measured difficulty, not on the number count. "Fewer numbers =
 * harder" is directionally true but varies wildly inside a tier, which is
 * exactly what ruins a speed-training app. Calibrated by test/verify.js.
 */
export const DIFFICULTIES: Record<DifficultyName, Difficulty> = {
  easy: {
    label: 'Easy', rows: 5, cols: 5, wallBudget: 5,
    waypoints: 6, maxWaypoints: 9, minGuesses: 1, maxGuesses: 4
  },
  medium: {
    label: 'Medium', rows: 6, cols: 6, wallBudget: 6,
    waypoints: 8, maxWaypoints: 11, minGuesses: 5, maxGuesses: 8
  },
  hard: {
    label: 'Hard', rows: 7, cols: 7, wallBudget: 6,
    waypoints: 11, maxWaypoints: 14, minGuesses: 9, maxGuesses: 13
  },
  expert: {
    label: 'Expert', rows: 8, cols: 8, wallBudget: 7,
    waypoints: 15, maxWaypoints: 18, minGuesses: 14, maxGuesses: Infinity
  }
};

export const DIFFICULTY_ORDER: DifficultyName[] = ['easy', 'medium', 'hard', 'expert'];

export function generateDifficulty(name: DifficultyName, seed?: number): Puzzle | null {
  const preset = DIFFICULTIES[name] ?? DIFFICULTIES.medium;
  const puzzle = generate({
    ...preset,
    rng: mulberry32(seed ?? ((Math.random() * 4294967296) >>> 0))
  });
  if (puzzle) puzzle.difficulty = name;
  return puzzle;
}
