/*
 * Generation verification. For every difficulty, generate N puzzles and assert:
 *   1. the stored solution actually satisfies the rules (walls, order, coverage)
 *   2. the puzzle has exactly one solution
 *   3. the measured difficulty lands inside the tier's band
 *   4. numbers are inside the grid, walls sit on real adjacencies and never on
 *      an edge the solution uses
 * Usage: node test/verify.js [samplesPerTier]
 */
const Z = require('./load.js').loadEngine();

const N = parseInt(process.argv[2] || '500', 10);
let failures = 0;

function fail(tier, i, msg, puzzle) {
  failures++;
  console.log(`  FAIL ${tier}#${i}: ${msg}`);
  if (failures <= 3) console.log('    ' + JSON.stringify({ w: puzzle.walls, n: puzzle.waypoints }));
}

for (const tier of Z.DIFFICULTY_ORDER) {
  const cfg = Z.DIFFICULTIES[tier];
  const n = cfg.rows * cfg.cols;
  const guesses = [], walls = [], nums = [], times = [];
  let made = 0;
  const before = failures;

  for (let i = 0; i < N; i++) {
    const t0 = Date.now();
    const puzzle = Z.generateDifficulty(tier, 1_000_000 + i);
    times.push(Date.now() - t0);
    if (!puzzle) { failures++; console.log(`  FAIL ${tier}#${i}: generator returned null`); continue; }
    made++;

    const eng = Z.makeEngine(puzzle);

    // 1. stored solution is legal by the rules alone
    if (!eng.validate(puzzle.solution)) fail(tier, i, 'stored solution violates the rules', puzzle);

    // 2. exactly one solution
    const count = eng.countSolutions(2);
    if (count !== 1) fail(tier, i, `solution count = ${count}, expected 1`, puzzle);

    // 3. difficulty inside the band
    const st = eng.analyze(puzzle.solution);
    if (st.guesses < cfg.minGuesses || st.guesses > cfg.maxGuesses) {
      fail(tier, i, `guesses ${st.guesses} outside [${cfg.minGuesses}, ${cfg.maxGuesses}]`, puzzle);
    }

    // 4. structural sanity
    const solEdges = new Set();
    for (let k = 0; k + 1 < puzzle.solution.length; k++) {
      const a = puzzle.solution[k], b = puzzle.solution[k + 1];
      solEdges.add(a < b ? `${a},${b}` : `${b},${a}`);
    }
    for (const [a, b] of puzzle.walls) {
      const rowA = (a / cfg.cols) | 0, rowB = (b / cfg.cols) | 0;
      const adjacent = (b - a === cfg.cols) || (b - a === 1 && rowA === rowB);
      if (!adjacent) fail(tier, i, `wall ${a}-${b} is not between adjacent cells`, puzzle);
      if (solEdges.has(`${a},${b}`)) fail(tier, i, `wall ${a}-${b} sits on the solution path`, puzzle);
    }
    if (new Set(puzzle.waypoints).size !== puzzle.waypoints.length) fail(tier, i, 'duplicate number cells', puzzle);
    if (puzzle.waypoints.some(c => c < 0 || c >= n)) fail(tier, i, 'number outside the grid', puzzle);

    guesses.push(st.guesses); walls.push(puzzle.walls.length); nums.push(puzzle.waypoints.length);
  }

  const avg = a => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
  const srt = a => a.slice().sort((x, y) => x - y);
  const g = srt(guesses), t = srt(times);
  console.log(
    `${tier.padEnd(7)} ${made}/${N} generated, ${failures === before ? 'all checks pass' : 'FAILURES'}  |  ` +
    `guesses ${g[0]}-${g[g.length - 1]} (median ${g[g.length >> 1]}), ` +
    `walls ${avg(walls)}, numbers ${avg(nums)}, ` +
    `${avg(times)}ms avg / ${t[Math.floor(0.95 * t.length)]}ms p95`
  );
}

console.log(failures === 0 ? `\nOK - ${N} puzzles per tier, 0 failures.` : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
