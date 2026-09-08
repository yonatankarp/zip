/*
 * Where puzzles come from.
 *
 * A worker when the browser has one, so generating an Expert board never
 * stutters the board already on screen; a direct call otherwise, so nothing
 * depends on the worker existing. Callers cannot tell which they got.
 */
import { generateDifficulty, type DifficultyName, type Puzzle } from '../engine/zip.ts';
import { generateDaily } from './daily.ts';
import type { GenerateReply, GenerateRequest } from './generate.worker.ts';

export class PuzzleSource {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (puzzle: Puzzle | null) => void>();

  constructor() {
    try {
      this.worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (event: MessageEvent<GenerateReply>) => {
        const { id, puzzle } = event.data;
        this.waiting.get(id)?.(puzzle);
        this.waiting.delete(id);
      };
      this.worker.onerror = () => this.giveUpOnWorker();
      this.worker.onmessageerror = () => this.giveUpOnWorker();
    } catch {
      this.worker = null;
    }
  }

  get usingWorker(): boolean { return this.worker !== null; }

  /** Fall back for good, and settle anything already in flight. */
  private giveUpOnWorker(): void {
    const stranded = [...this.waiting.values()];
    this.waiting.clear();
    this.worker?.terminate();
    this.worker = null;
    for (const settle of stranded) settle(null);
  }

  requestDaily(seed: number): Promise<Puzzle | null> {
    return this.dispatch({ kind: 'daily', seed }, () => generateDaily(seed));
  }

  requestTier(tier: DifficultyName, seed?: number): Promise<Puzzle | null> {
    return this.dispatch({ kind: 'tier', tier, seed }, () => generateDifficulty(tier, seed));
  }

  private dispatch(
    request: Omit<GenerateRequest, 'id'>,
    directly: () => Puzzle | null
  ): Promise<Puzzle | null> {
    if (!this.worker) {
      // Yield a frame first so the caller can paint before this blocks.
      return new Promise(resolve => { setTimeout(() => resolve(directly()), 0); });
    }
    const id = ++this.seq;
    const message: GenerateRequest = { id, ...request };
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage(message);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.waiting.clear();
  }
}
