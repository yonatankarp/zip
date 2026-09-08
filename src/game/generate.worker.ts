/// <reference lib="webworker" />
/*
 * Puzzle generation off the main thread. An Expert board takes ~60ms on a
 * laptop and several times that on a phone, which is long enough to drop
 * frames on the board that is still on screen.
 */
import { generateDifficulty, type DifficultyName, type Puzzle } from '../engine/zip.ts';
import { generateDaily } from './daily.ts';

export interface GenerateRequest {
  id: number;
  /** The daily has its own frozen configuration; tiers come from the table. */
  kind: 'daily' | 'tier';
  tier?: DifficultyName;
  seed?: number;
}

export interface GenerateReply {
  id: number;
  puzzle: Puzzle | null;
}

self.addEventListener('message', (event: MessageEvent<GenerateRequest>) => {
  const { id, kind, tier, seed } = event.data;
  const puzzle = kind === 'daily'
    ? generateDaily(seed!)
    : generateDifficulty(tier!, seed);
  const reply: GenerateReply = { id, puzzle };
  (self as unknown as Worker).postMessage(reply);
});
