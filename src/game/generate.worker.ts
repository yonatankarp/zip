/// <reference lib="webworker" />
/*
 * Puzzle generation off the main thread. An Expert board takes ~60ms on a
 * laptop and several times that on a phone, which is long enough to drop
 * frames on the board that is still on screen.
 */
import { generateDifficulty, type DifficultyName, type Puzzle } from '../engine/zip.ts';

export interface GenerateRequest {
  id: number;
  tier: DifficultyName;
  seed?: number;
}

export interface GenerateReply {
  id: number;
  puzzle: Puzzle | null;
}

self.addEventListener('message', (event: MessageEvent<GenerateRequest>) => {
  const { id, tier, seed } = event.data;
  const reply: GenerateReply = { id, puzzle: generateDifficulty(tier, seed) };
  (self as unknown as Worker).postMessage(reply);
});
