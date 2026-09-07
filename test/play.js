/*
 * Interaction rules. Exercises the same canStep()/validate() the UI calls, so a
 * rule that is wrong here is wrong in the game.
 * Usage: node test/play.js [puzzlesPerTier]
 */
import * as Z from '../src/engine/zip.ts';
const N = parseInt(process.argv[2] || '50', 10);
let checks = 0, failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

for (const tier of Z.DIFFICULTY_ORDER) {
  const cfg = Z.DIFFICULTIES[tier];
  const n = cfg.rows * cfg.cols;
  for (let i = 0; i < N; i++) {
    const p = Z.generateDifficulty(tier, 500000 + i);
    const eng = Z.makeEngine(p);
    const path = [], inPath = new Uint8Array(n);

    // Nothing but the "1" cell may open the path.
    for (let c = 0; c < n; c++) {
      if (c !== p.waypoints[0]) ok(!eng.canStep(path, inPath, c), `${tier}#${i}: opened path on cell ${c}`);
    }
    ok(eng.canStep(path, inPath, p.waypoints[0]), `${tier}#${i}: cannot start on number 1`);

    // Play the intended solution one legal step at a time.
    for (let k = 0; k < n; k++) {
      const cell = p.solution[k];
      ok(eng.canStep(path, inPath, cell), `${tier}#${i}: solution step ${k} rejected`);
      path.push(cell); inPath[cell] = 1;

      if (k + 1 < n) {
        // Revisiting a drawn cell is never a legal step.
        ok(!eng.canStep(path, inPath, p.solution[0]), `${tier}#${i}: allowed revisit at step ${k}`);
        // Walls block: a grid-neighbour behind a wall must be refused.
        const row = (cell / p.cols) | 0, col = cell % p.cols;
        const grid = [];
        if (row > 0) grid.push(cell - p.cols);
        if (row < p.rows - 1) grid.push(cell + p.cols);
        if (col > 0) grid.push(cell - 1);
        if (col < p.cols - 1) grid.push(cell + 1);
        for (const g of grid) {
          const walled = p.walls.some(w => (w[0] === Math.min(cell, g) && w[1] === Math.max(cell, g)));
          if (walled) ok(!eng.canStep(path, inPath, g), `${tier}#${i}: crossed wall ${cell}-${g}`);
        }
        // Numbers out of order must be refused.
        const taken = path.filter(c => eng.numAt[c] !== 0).length;
        for (let m = taken + 2; m <= p.waypoints.length; m++) {
          const far = p.waypoints[m - 1];
          if (!inPath[far]) ok(!eng.canStep(path, inPath, far), `${tier}#${i}: took number ${m} early`);
        }
      }
    }
    ok(eng.validate(path), `${tier}#${i}: completed solution failed validation`);

    // A path that covers every cell but ends elsewhere must not validate.
    const swapped = path.slice(0, n - 2).concat([path[n - 1], path[n - 2]]);
    ok(!eng.validate(swapped), `${tier}#${i}: validated a scrambled path`);
    ok(!eng.validate(path.slice(0, n - 1)), `${tier}#${i}: validated an incomplete path`);
  }
  console.log(`${tier.padEnd(7)} ${N} puzzles played through — ${failures === 0 ? 'clean' : failures + ' failures'}`);
}
console.log(failures === 0 ? `\nOK — ${checks.toLocaleString()} rule assertions, 0 failures.` : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
