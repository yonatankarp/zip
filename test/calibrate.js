/*
 * Difficulty calibration. With the number counts fixed per tier, measure what
 * the "decision point" distribution actually is, so the bands are set from data
 * rather than guessed. Not part of the suite -- run it when tier shapes change.
 */
import { generate, makeEngine, mulberry32 } from '../src/engine/zip.ts';

const SHAPES = [
  { name: 'easy   5x5', rows: 5, cols: 5, numbers: [5, 6] },
  { name: 'medium 6x6', rows: 6, cols: 6, numbers: [7, 8] },
  { name: 'hard   7x7', rows: 7, cols: 7, numbers: [10, 11] },
  { name: 'expert 8x8', rows: 8, cols: 8, numbers: [13, 15] }
];
const WALLS = [3, 6];
const SAMPLES = 12;

const pct = (a, q) => a.length ? a[Math.min(a.length - 1, Math.floor(q * a.length))] : NaN;

console.log('shape        nums walls  yield   guesses p10/p50/p90   avgWalls  ms');
for (const shape of SHAPES) {
  for (const numbers of shape.numbers) {
    for (const wallBudget of WALLS) {
      const rng = mulberry32(4242 + numbers * 31 + wallBudget);
      const guesses = [], usedWalls = [];
      let made = 0;
      const t0 = Date.now();
      for (let i = 0; i < SAMPLES; i++) {
        const p = generate({
          rows: shape.rows, cols: shape.cols, rng,
          waypoints: numbers, maxWaypoints: numbers + 3,
          wallBudget, seedWalls: Math.min(2, wallBudget),
          maxAttempts: 60
        });
        if (!p) continue;
        made++;
        guesses.push(makeEngine(p).analyze(p.solution).guesses);
        usedWalls.push(p.walls.length);
      }
      guesses.sort((a, b) => a - b);
      const avg = a => a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1) : '-';
      console.log(
        `${shape.name}  ${String(numbers).padStart(3)}  ${String(wallBudget).padStart(4)}  ` +
        `${String(made).padStart(2)}/${SAMPLES}   ` +
        `${String(pct(guesses, 0.1)).padStart(3)} /${String(pct(guesses, 0.5)).padStart(3)} /${String(pct(guesses, 0.9)).padStart(3)}        ` +
        `${avg(usedWalls).padStart(5)}  ${((Date.now() - t0) / SAMPLES).toFixed(0)}`
      );
    }
  }
}
