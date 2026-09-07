/*
 * The daily puzzle.
 *
 * Everyone gets the same board on the same date because the generator is
 * seeded, deterministic and pure -- no server involved. Days are counted in UTC
 * so the puzzle turns over at the same instant everywhere rather than at each
 * player's local midnight.
 */
import type { DifficultyName } from '../engine/zip.ts';

/** Puzzle #1 is 1 January 2026. */
const EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

/** The daily is one fixed size, the way the original is. */
export const DAILY_TIER: DifficultyName = 'medium';

export interface DailyResult {
  day: number;
  ms: number;
  backtracks: number;
  hinted: boolean;
}

export function dayNumber(now: Date = new Date()): number {
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
    return raw ? JSON.parse(raw) as DailyResult : null;
  } catch {
    return null;
  }
}

/** First solve of the day is the one that counts; replays do not overwrite it. */
export function writeResult(result: DailyResult): void {
  if (readResult(result.day)) return;
  localStorage.setItem(key(result.day), JSON.stringify(result));
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
