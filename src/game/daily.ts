/*
 * The daily puzzle.
 *
 * Everyone gets the same board on the same date because the generator is
 * seeded, deterministic and pure -- no server involved. Days are counted in UTC
 * so the puzzle turns over at the same instant everywhere rather than at each
 * player's local midnight.
 */
import { generate, mulberry32, type GenerateOptions, type Puzzle } from '../engine/zip.ts';

/** Puzzle #1 is 1 January 2026. */
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

/*
 * Frozen on purpose.
 *
 * The daily must produce the same board for a given date forever, and it used
 * to be generated from DIFFICULTIES.medium -- the same table that gets retuned
 * whenever the tiers are rebalanced. Retuning it once already changed how many
 * numbers a board carries, which would silently have changed every past daily.
 * These values are a copy, deliberately detached from the tier table: change
 * them and you change history, so don't.
 */
export const DAILY_PUZZLE: GenerateOptions = Object.freeze({
  rows: 6,
  cols: 6,
  wallBudget: 6,
  waypoints: 8,
  maxWaypoints: 11,
  minGuesses: 5,
  maxGuesses: 8
});

/** The version stamped into anything written to storage. */
export const STORAGE_VERSION = 1;

export function generateDaily(seed: number): Puzzle | null {
  const puzzle = generate({ ...DAILY_PUZZLE, rng: mulberry32(seed) });
  if (puzzle) puzzle.difficulty = 'medium';
  return puzzle;
}

/*
 * A cheap identity for a board. Recorded with each result so that if the
 * generator ever does change, a stored result can be recognised as belonging to
 * a puzzle that no longer exists rather than being trusted blindly.
 */
export function fingerprint(puzzle: Puzzle): string {
  let hash = 0x811c9dc5;
  const parts = `${puzzle.rows}x${puzzle.cols}|${puzzle.waypoints.join(',')}|` +
    puzzle.walls.map(w => `${w[0]}-${w[1]}`).join(',');
  for (let i = 0; i < parts.length; i++) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/*
 * The clock, injectable so the UTC-midnight rollover can actually be tested --
 * the moment the whole daily hinges on, and previously the one thing no test
 * could reach.
 */
let clock: () => Date = () => new Date();
export function setClock(fn: () => Date): void { clock = fn; }

export interface DailyResult {
  /** Storage shape version; absent means the original unversioned shape. */
  v?: number;
  day: number;
  ms: number;
  backtracks: number;
  hinted: boolean;
  /** Which board this was; absent on results written before boards were stamped. */
  board?: string;
}

export function dayNumber(now: Date = clock()): number {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((midnight - EPOCH_UTC) / DAY_MS) + 1;
}

/** Spread consecutive days across the seed space so neighbouring days differ. */
export function seedForDay(day: number): number {
  return (day * 2654435761) >>> 0;
}

const key = (day: number) => `zip.daily.${day}`;

export function readResult(day: number): DailyResult | null {
  try {
    const raw = localStorage.getItem(key(day));
    if (!raw) return null;
    const saved = JSON.parse(raw) as DailyResult;
    // Unversioned entries predate the version stamp and share this shape, so
    // they are accepted and restamped on next write. Anything from a *newer*
    // version is not understood and is ignored rather than mis-read.
    if (saved.v !== undefined && saved.v > STORAGE_VERSION) return null;
    if (typeof saved.day !== 'number' || typeof saved.ms !== 'number') return null;
    return saved;
  } catch {
    return null;
  }
}

/** First solve of the day is the one that counts; replays do not overwrite it. */
export function writeResult(result: DailyResult): void {
  if (readResult(result.day)) return;
  localStorage.setItem(key(result.day), JSON.stringify({ ...result, v: STORAGE_VERSION }));
}

/*
 * Consecutive days solved. Counts back from today if today is already done,
 * otherwise from yesterday -- a streak stands until a day is actually missed,
 * so it is visible (and at stake) before you have played.
 */
export function streak(today: number = dayNumber()): number {
  let day = readResult(today) ? today : today - 1;
  let count = 0;
  for (; day > 0 && readResult(day); day--) count++;
  return count;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`;
}

export function shareText(result: DailyResult, days: number, url: string): string {
  const lines = [
    `Zip #${result.day} — ${formatDuration(result.ms)}`,
    `↩ ${result.backtracks} backtrack${result.backtracks === 1 ? '' : 's'}` +
      (result.hinted ? ' · used a hint' : '') +
      (days >= 2 ? ` · 🔥 ${days} day streak` : '')
  ];
  return `${lines.join('\n')}\n${url}`;
}

/*
 * In-progress state for today's board.
 *
 * Without this, reloading mid-solve hands you a fresh board and a zero clock --
 * which is exactly the reset that Restart is deliberately not allowed to give
 * you. Only the daily is kept: a practice reload draws a different puzzle
 * anyway, so there is no run to preserve.
 */
export interface DailyProgress {
  v?: number;
  /** The board this run belongs to; a different one means discard it. */
  board?: string;
  day: number;
  path: number[];
  elapsed: number;
  backtracks: number;
  hintsUsed: number;
}

const PROGRESS_KEY = 'zip.progress';

export function readProgress(day: number): DailyProgress | null {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as DailyProgress;
    if (saved.v !== undefined && saved.v > STORAGE_VERSION) return null;
    if (saved.day !== day || !Array.isArray(saved.path)) return null;
    return saved;
  } catch {
    return null;
  }
}

export function writeProgress(progress: DailyProgress): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ ...progress, v: STORAGE_VERSION }));
  } catch { /* storage full or blocked; losing progress is not worth throwing */ }
}

export function clearProgress(): void {
  localStorage.removeItem(PROGRESS_KEY);
}

export interface HistoryEntry {
  day: number;
  result: DailyResult | null;
}

export interface HistorySummary {
  entries: HistoryEntry[];
  solved: number;
  best: number | null;
  median: number | null;
}

/*
 * The last `span` days, oldest first. Every daily result has been on disk since
 * the feature shipped; until now only the streak counter ever read it.
 */
export function history(today: number = dayNumber(), span = 30): HistorySummary {
  const entries: HistoryEntry[] = [];
  for (let day = Math.max(1, today - span + 1); day <= today; day++) {
    entries.push({ day, result: readResult(day) });
  }
  const times = entries
    .map(e => e.result?.ms)
    .filter((ms): ms is number => typeof ms === 'number')
    .sort((a, b) => a - b);
  return {
    entries,
    solved: times.length,
    best: times.length ? times[0]! : null,
    median: times.length ? times[(times.length - 1) >> 1]! : null
  };
}
