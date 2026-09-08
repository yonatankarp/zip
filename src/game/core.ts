/*
 * The game itself: state, rules, input, timing and animation.
 *
 * Deliberately framework-free. The hot path -- drawing while dragging, and the
 * animation frame -- mutates the DOM directly and never touches React state.
 * What React needs (counts, timings, banner, preferences) is published as a
 * snapshot at most once per animation frame, so the chrome re-renders at a
 * human rate no matter how fast the pointer moves.
 */
import {
  DIFFICULTIES, generateDifficulty, makeEngine,
  type Cell, type DifficultyName, type Engine, type Puzzle
} from '../engine/zip.ts';
import { BoardView, U, type Tip } from './board.ts';
import { Audio, SOUND_MODES, type SoundMode } from './audio.ts';
import { Fx } from './fx.ts';
import { PuzzleSource } from './source.ts';
import {
  DAILY_TIER, clearProgress, dayNumber, readProgress, readResult, seedForDay,
  shareText, streak, writeProgress, writeResult,
  type DailyResult
} from './daily.ts';

export type Theme = 'system' | 'light' | 'dark';
/** Daily is one shared board per UTC day; practice is the endless generator. */
export type Mode = 'daily' | 'practice';
export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';
export type BannerKind = 'good' | 'bad' | 'wait';

export interface Banner {
  text: string;
  kind: BannerKind;
  sub?: string;
}

export interface Snapshot {
  ready: boolean;
  busy: boolean;
  mode: Mode;
  day: number;
  dailyResult: DailyResult | null;
  streak: number;
  backtracks: number;
  rows: number;
  cols: number;
  difficulty: DifficultyName;
  difficultyLabel: string;
  filled: number;
  total: number;
  solved: boolean;
  best: number | null;
  session: { solved: number; total: number; streak: number };
  banner: Banner | null;
  /** The number the line is heading for next, for the board's accessible name. */
  nextNumber: number;
  autoNext: boolean;
  soundMode: SoundMode;
  theme: Theme;
}

const AUTO_NEXT_DELAY = 1800;

/** A little variety on the win line, never the same one twice running. */
const CHEERS = ['Nice.', 'Clean run.', 'Smooth.', 'Tidy.', 'Got it.', 'Locked in.'];

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
};

function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function formatTime(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}.${Math.floor((s * 10) % 10)}`;
}

export class GameCore {
  private board: BoardView | null = null;
  private fx: Fx | null = null;
  private clockEl: HTMLElement | null = null;
  private announcerEl: HTMLElement | null = null;
  private regionEl: HTMLElement | null = null;

  private puzzle: Puzzle | null = null;
  private engine: Engine | null = null;
  private path: Cell[] = [];
  private inPath = new Uint8Array(0);

  private drag = { active: false, at: null as { x: number; y: number } | null, tip: null as Tip | null, settle: null as Tip | null };

  private startedAt = 0;
  private elapsed = 0;
  private running = false;
  private timerStarted = false;
  private solved = false;
  private revealed = false;
  private hintsUsed = 0;
  /** Single-cell retractions, the way the original counts them. */
  private backtracks = 0;
  private busy = false;
  private banner: Banner | null = null;
  private lastCheer = -1;

  private prefetched: Puzzle | null = null;
  private prefetchedFor: DifficultyName | null = null;
  private advanceTimer = 0;
  private bannerTimer = 0;

  private frame = 0;
  private alive = false;
  /*
   * Generation is deferred a frame so the board can paint first, which means a
   * result can arrive after something else has already been loaded -- switch
   * difficulty twice quickly and the first generation would land on top of the
   * second. Every load claims a token; a stale generation drops its result.
   */
  private loadSeq = 0;
  private savedAt = 0;
  private dirty = true;
  private listeners = new Set<(s: Snapshot) => void>();
  private detachers: Array<() => void> = [];

  readonly audio: Audio;
  private readonly source = new PuzzleSource();
  difficulty: DifficultyName;
  mode: Mode;
  day = dayNumber();
  autoNext: boolean;
  theme: Theme;
  session = { solved: 0, total: 0, streak: 0 };

  constructor() {
    const storedSound = localStorage.getItem('zip.sound');
    const mode: SoundMode =
      storedSound === 'on' ? 'all'
        : SOUND_MODES.includes(storedSound as SoundMode) ? storedSound as SoundMode
          : 'off';
    this.audio = new Audio(mode);
    this.difficulty = (localStorage.getItem('zip.difficulty') as DifficultyName) ?? 'medium';
    if (!DIFFICULTIES[this.difficulty]) this.difficulty = 'medium';
    this.mode = localStorage.getItem('zip.mode') === 'practice' ? 'practice' : 'daily';
    this.autoNext = localStorage.getItem('zip.autoNext') !== 'off';
    this.theme = (localStorage.getItem('zip.theme') as Theme) ?? 'system';
    this.applyTheme();
  }

  // -------------------------------------------------------------- lifecycle

  attach(boardSvg: SVGSVGElement, fxSvg: SVGSVGElement): void {
    this.board = new BoardView(boardSvg);
    this.fx = new Fx(fxSvg);

    const down = (e: PointerEvent) => this.onPointerDown(e, boardSvg);
    const move = (e: PointerEvent) => this.onPointerMove(e);
    const up = (e: PointerEvent) => this.onPointerUp(e, boardSvg);
    const key = (e: KeyboardEvent) => this.onKey(e);
    const resize = () => this.board?.invalidateRect();
    // A tab can be discarded without ever firing unload, so flush on the way out.
    const leaving = () => this.saveProgress(true);

    boardSvg.addEventListener('pointerdown', down);
    boardSvg.addEventListener('pointermove', move);
    boardSvg.addEventListener('pointerup', up);
    boardSvg.addEventListener('pointercancel', up);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', resize);
    window.addEventListener('scroll', resize, true);
    window.addEventListener('pagehide', leaving);
    document.addEventListener('visibilitychange', leaving);
    this.detachers = [
      () => boardSvg.removeEventListener('pointerdown', down),
      () => boardSvg.removeEventListener('pointermove', move),
      () => boardSvg.removeEventListener('pointerup', up),
      () => boardSvg.removeEventListener('pointercancel', up),
      () => document.removeEventListener('keydown', key),
      () => window.removeEventListener('resize', resize),
      () => window.removeEventListener('scroll', resize, true),
      () => window.removeEventListener('pagehide', leaving),
      () => document.removeEventListener('visibilitychange', leaving)
    ];

    this.alive = true;
    this.frame = requestAnimationFrame(this.tick);
    this.newPuzzle();
  }

  destroy(): void {
    this.alive = false;                        // pending timers bail out
    this.source.terminate();
    cancelAnimationFrame(this.frame);
    clearTimeout(this.advanceTimer);
    clearTimeout(this.bannerTimer);
    for (const off of this.detachers) off();
    this.detachers = [];
    this.listeners.clear();
  }

  bindClock(el: HTMLElement | null): void { this.clockEl = el; }
  bindAnnouncer(el: HTMLElement | null): void { this.announcerEl = el; }
  bindRegion(el: HTMLElement | null): void { this.regionEl = el; }

  /*
   * Spoken feedback for anyone who cannot see the line. Without this the game
   * is unplayable with a screen reader: the board is an <svg> that changes by
   * direct mutation, so nothing else would ever be announced.
   */
  private announce(text: string): void {
    if (!this.announcerEl) return;
    // Repeating identical text is not re-announced, so nudge it.
    this.announcerEl.textContent = this.announcerEl.textContent === text ? `${text} ` : text;
  }

  private describe(cell: Cell): string {
    const cols = this.puzzle!.cols;
    const where = `Row ${((cell / cols) | 0) + 1}, column ${(cell % cols) + 1}`;
    const number = this.engine!.numAt[cell]!;
    return number
      ? `${where}, number ${number} of ${this.puzzle!.waypoints.length}`
      : where;
  }

  subscribe(fn: (s: Snapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot());
    return () => this.listeners.delete(fn);
  }

  // --------------------------------------------------------------- snapshot

  private markDirty(): void { this.dirty = true; }

  /** The daily is one fixed size; practice follows the chosen tier. */
  private tier(): DifficultyName {
    return this.mode === 'daily' ? DAILY_TIER : this.difficulty;
  }

  snapshot(): Snapshot {
    const preset = DIFFICULTIES[this.tier()];
    const best = localStorage.getItem(this.bestKey());
    return {
      ready: !!this.puzzle,
      busy: this.busy,
      mode: this.mode,
      day: this.day,
      dailyResult: readResult(this.day),
      streak: streak(this.day),
      backtracks: this.backtracks,
      rows: this.puzzle?.rows ?? preset.rows,
      cols: this.puzzle?.cols ?? preset.cols,
      difficulty: this.tier(),
      difficultyLabel: preset.label,
      filled: this.path.length,
      total: this.puzzle ? this.puzzle.rows * this.puzzle.cols : preset.rows * preset.cols,
      solved: this.solved,
      best: best === null ? null : Number(best),
      session: { ...this.session },
      banner: this.banner,
      nextNumber: Math.min(this.numbersTaken() + 1, this.puzzle?.waypoints.length ?? 1),
      autoNext: this.autoNext,
      soundMode: this.audio.mode,
      theme: this.theme
    };
  }

  private publish(): void {
    const snap = this.snapshot();
    for (const fn of this.listeners) fn(snap);
  }

  // ------------------------------------------------------------- animation

  private tick = (): void => {
    const now = performance.now();
    if (this.running) this.elapsed = now - this.startedAt;
    if (this.clockEl) {
      this.clockEl.textContent = formatTime(this.elapsed);
      this.clockEl.classList.toggle('done', this.solved);
    }
    if (this.drag.settle) {                    // ease the tip back rather than snap
      this.drag.settle.amount *= 0.6;
      if (this.drag.settle.amount < 0.8) this.drag.settle = null;
      this.renderTrail();
    }
    this.board?.tick(now);
    this.fx?.tick(now);
    this.saveProgress();
    if (this.dirty) {
      this.dirty = false;
      this.publish();
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  // --------------------------------------------------------------- drawing

  private lineColour(): string {
    return this.solved ? 'var(--good)' : this.revealed ? 'var(--dim)' : 'var(--path)';
  }

  private numbersTaken(): number {
    let count = 0;
    for (const cell of this.path) if (this.engine!.numAt[cell] !== 0) count++;
    return count;
  }

  private renderTrail(): void {
    this.board?.drawTrail(this.path, this.drag.tip ?? this.drag.settle, this.lineColour());
  }

  private render(): void {
    this.renderTrail();
    this.board?.drawNumbers(this.inPath, this.numbersTaken(), this.lineColour(),
      !this.solved && !this.revealed);
    this.markDirty();
  }

  // ----------------------------------------------------------------- moves

  private push(cell: Cell): void {
    this.path.push(cell);
    this.inPath[cell] = 1;
    this.startClock();
    this.board?.clearHint();
    const number = this.engine!.numAt[cell]!;
    if (number) {
      this.audio.number(number - 1);
      this.board?.popNumber(number - 1);
    } else {
      this.audio.step(this.path.length / this.engine!.n);
    }
    this.announce(this.describe(cell));
    this.render();
    this.checkWin();
  }

  private pop(): void {
    if (this.path.length <= 1) return;
    const removed = this.path.pop()!;
    this.inPath[removed] = 0;
    this.backtracks++;
    this.announce(`Backed out of ${this.describe(removed).toLowerCase()}`);
    this.solved = false;
    this.board?.clearHint();
    this.setBanner(null);
    this.render();
  }

  private step(cell: Cell): void {
    if (this.solved || this.revealed || !this.engine) return;
    if (!this.path.length) {
      if (this.engine.canStep(this.path, this.inPath, cell)) this.push(cell);
      return;
    }
    const head = this.path[this.path.length - 1]!;
    if (cell === head) return;
    if (this.path.length > 1 && cell === this.path[this.path.length - 2]) { this.pop(); return; }
    // Anything else already on the line is ignored. Letting the head jump back
    // to an arbitrary drawn cell meant one stray movement erased everything
    // after it; the only way back is to retrace, one square at a time.
    if (this.inPath[cell]) return;
    if (this.engine.canStep(this.path, this.inPath, cell)) this.push(cell);
  }

  private checkWin(): void {
    if (!this.engine || this.path.length !== this.engine.n) return;
    if (this.engine.validate(this.path)) {     // checked against the rules, not the stored path
      this.solved = true;
      this.running = false;
      this.render();
      this.recordSolve();
    } else {
      const message = 'Every cell filled, but the path must end on the last number.';
      this.setBanner({ text: message, kind: 'bad' });
      this.announce(message);
    }
  }

  // ----------------------------------------------------------------- clock

  private startClock(): void {
    if (this.running || this.solved) return;
    this.running = true;
    this.timerStarted = true;
    this.startedAt = performance.now() - this.elapsed;
  }

  private bestKey(): string { return `zip.best.${this.difficulty}`; }

  private cheer(): string {
    let pick = this.lastCheer;
    while (pick === this.lastCheer && CHEERS.length > 1) pick = (Math.random() * CHEERS.length) | 0;
    this.lastCheer = pick;
    return CHEERS[pick]!;
  }

  private recordSolve(): void {
    if (this.revealed) return;
    this.session.solved++;
    this.session.total += this.elapsed;
    this.session.streak++;

    const backtracks = `${this.backtracks} backtrack${this.backtracks === 1 ? '' : 's'}`;
    let isBest = false;

    if (this.mode === 'daily') {
      // Only the first solve of the day is recorded; replaying does not
      // overwrite it, so the shared result stays honest.
      const first = !readResult(this.day);
      writeResult({
        day: this.day, ms: Math.round(this.elapsed),
        backtracks: this.backtracks, hinted: this.hintsUsed > 0
      });
      clearProgress();                         // the run is over
      const days = streak(this.day);
      this.setBanner({
        text: `Daily #${this.day} · ${formatTime(this.elapsed)}`,
        kind: 'good',
        sub: `${backtracks}${this.hintsUsed ? ' · used a hint' : ''}` +
          (first && days >= 2 ? ` · ${days} day streak` : first ? '' : ' · already logged today')
      });
    } else {
      const previous = Number(localStorage.getItem(this.bestKey()) ?? Infinity);
      // A hinted solve counts for the session but never sets a record -- a best
      // time you were walked through is not a time.
      isBest = this.elapsed < previous && this.hintsUsed === 0;
      if (isBest) localStorage.setItem(this.bestKey(), String(Math.round(this.elapsed)));

      let sub: string | undefined;
      if (this.hintsUsed) {
        sub = `${this.hintsUsed} ${this.hintsUsed === 1 ? 'hint' : 'hints'} — not a record`;
      } else if (Number.isFinite(previous)) {
        sub = isBest ? `beat ${formatTime(previous)}` : `${formatTime(this.elapsed - previous)} off your best`;
      }
      this.setBanner({
        text: `${isBest ? 'New best · ' : `${this.cheer()} · `}${formatTime(this.elapsed)}`,
        kind: 'good', sub: sub ? `${backtracks} · ${sub}` : backtracks
      });
    }

    this.audio.win(isBest);
    if (!reducedMotion()) {
      this.board?.startSweep(this.path.length);
      this.board?.pop();
      const origin = this.board?.centreInViewport(this.path[this.path.length - 1]!);
      const rect = this.board?.rectInViewport();
      if (origin && rect) this.fx?.celebrate(origin, rect, isBest);
    }
    // Auto-next belongs to practice: there is only one puzzle a day.
    if (this.autoNext && this.mode === 'practice') {
      this.advanceTimer = window.setTimeout(() => this.newPuzzle(), AUTO_NEXT_DELAY);
    }
  }

  private setBanner(banner: Banner | null): void {
    this.banner = banner;
    if (banner) this.announce(banner.sub ? `${banner.text}. ${banner.sub}` : banner.text);
    this.markDirty();
  }

  // --------------------------------------------------------------- puzzles

  private prefetch(): void {
    const want = this.difficulty;
    window.setTimeout(async () => {
      if (!this.alive || (this.prefetchedFor === want && this.prefetched)) return;
      const puzzle = await this.source.request(want);
      if (!this.alive || !puzzle) return;
      this.prefetched = puzzle;
      this.prefetchedFor = want;
    }, 250);
  }

  private load(puzzle: Puzzle): void {
    this.loadSeq++;
    this.busy = false;                         // a loaded board is never busy
    this.puzzle = puzzle;
    this.engine = makeEngine(puzzle);
    this.path = [];
    this.inPath = new Uint8Array(puzzle.rows * puzzle.cols);
    this.elapsed = 0;
    this.running = false;
    this.timerStarted = false;
    this.solved = false;
    this.revealed = false;
    this.hintsUsed = 0;
    this.backtracks = 0;
    this.drag = { active: false, at: null, tip: null, settle: null };
    this.fx?.clear();
    this.setBanner(null);
    this.board?.setPuzzle(puzzle);
    this.render();
  }

  newPuzzle(): void {
    clearTimeout(this.advanceTimer);
    if (this.mode === 'daily') { this.loadDaily(); return; }
    const ready = this.prefetchedFor === this.difficulty ? this.prefetched : null;
    this.prefetched = null;
    this.prefetchedFor = null;
    if (ready) { this.load(ready); this.prefetch(); return; }

    this.busy = true;
    this.setBanner({ text: 'Generating…', kind: 'wait' });
    this.publish();
    const seq = this.loadSeq;
    void this.source.request(this.difficulty).then(puzzle => {
      if (!this.alive || seq !== this.loadSeq) return;   // superseded
      this.busy = false;
      this.setBanner(null);
      if (puzzle) this.load(puzzle);
      this.prefetch();
    });
  }

  /*
   * The same board for everyone on the same UTC date, straight from the seeded
   * generator -- no server, no fetch. Reloading it is how "New" behaves in
   * daily mode, since there is nothing else to move on to.
   */
  private loadDaily(): void {
    this.day = dayNumber();
    const seq = this.loadSeq;
    void this.source.request(DAILY_TIER, seedForDay(this.day)).then(puzzle => {
      if (!this.alive || seq !== this.loadSeq || !puzzle) return;
      this.load(puzzle);
      this.restoreProgress();
    });
  }

  /*
   * Replay a saved run, checking every step against the rules as it goes. A
   * stored path could be stale or hand-edited; anything that does not replay
   * cleanly is discarded rather than trusted.
   */
  private restoreProgress(): void {
    const saved = readProgress(this.day);
    if (!saved || readResult(this.day)) return;      // already finished today
    const engine = this.engine!;
    const path: Cell[] = [];
    const inPath = new Uint8Array(this.inPath.length);
    for (const cell of saved.path) {
      if (!engine.canStep(path, inPath, cell)) return;
      path.push(cell);
      inPath[cell] = 1;
    }
    if (!path.length) return;
    this.path = path;
    this.inPath = inPath;
    this.backtracks = saved.backtracks;
    this.hintsUsed = saved.hintsUsed;
    this.elapsed = saved.elapsed;
    // The clock belongs to the puzzle, so it picks up where it left off rather
    // than waiting for the next move.
    this.timerStarted = true;
    this.running = true;
    this.startedAt = performance.now() - this.elapsed;
    this.render();
  }

  /** Cheap enough to call every frame; throttled so storage is not hammered. */
  private saveProgress(force = false): void {
    if (this.mode !== 'daily' || !this.puzzle || this.solved || this.revealed) return;
    const now = performance.now();
    if (!force && now - this.savedAt < 1000) return;
    this.savedAt = now;
    if (!this.path.length) { clearProgress(); return; }
    writeProgress({
      day: this.day,
      path: this.path.slice(),
      elapsed: Math.round(this.elapsed),
      backtracks: this.backtracks,
      hintsUsed: this.hintsUsed
    });
  }

  setMode(mode: Mode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    localStorage.setItem('zip.mode', mode);
    this.newPuzzle();
    this.markDirty();
  }

  /*
   * Hand the day's result to the native share sheet where there is one -- on a
   * phone that means Messages, WhatsApp, Slack, whatever they actually use --
   * and fall back to the clipboard everywhere else. Per-network buttons were
   * the alternative and are worse: they only reach one place, and prefilled
   * text survives the trip unreliably.
   *
   * navigator.share must be reached from the user gesture, so nothing may be
   * awaited before it.
   */
  async share(): Promise<ShareOutcome> {
    const result = readResult(this.day);
    if (!result) return 'failed';
    const text = shareText(result, streak(this.day), location.origin + location.pathname);

    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Zip', text });
        return 'shared';
      } catch (err) {
        // Dismissing the sheet is a decision, not a failure; do not then go
        // and quietly put it on the clipboard instead.
        if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  restart(): void {
    clearTimeout(this.advanceTimer);
    this.path = [];
    this.inPath.fill(0);
    this.solved = false;
    this.revealed = false;
    /*
     * The clock belongs to the puzzle, not the attempt. Clearing the board
     * never clears the time -- otherwise a bad run could be wiped to protect a
     * best -- and it resumes straight away rather than waiting for the first
     * move, so hesitating after a restart costs what it should.
     */
    if (this.timerStarted) {
      this.running = true;
      this.startedAt = performance.now() - this.elapsed;
    }
    this.drag.tip = null;
    this.drag.settle = null;
    this.board?.clearHint();
    this.fx?.clear();
    this.setBanner(null);
    this.render();
  }

  undo(): void { this.pop(); }

  reveal(): void {
    if (!this.puzzle) return;
    clearTimeout(this.advanceTimer);
    this.running = false;
    this.revealed = true;
    this.solved = false;
    this.session.streak = 0;
    this.path = this.puzzle.solution.slice();
    this.inPath.fill(1);
    this.render();
    this.setBanner({ text: 'Revealed', kind: 'bad' });
  }

  /*
   * Because each puzzle has exactly one solution, any path that can still be
   * finished must be a prefix of it -- so one check answers both "what is the
   * next move" and "is this position already lost".
   */
  private salvageable(): boolean {
    const solution = this.puzzle!.solution;
    if (this.path.length > solution.length) return false;
    return this.path.every((cell, i) => cell === solution[i]);
  }

  hint(): void {
    if (!this.puzzle || this.solved || this.revealed) return;
    clearTimeout(this.advanceTimer);
    const solution = this.puzzle.solution;
    if (!this.salvageable()) {
      this.restart();
      this.setBanner({ text: 'Off track — back to the start', kind: 'bad' });
      this.bannerTimer = window.setTimeout(() => this.setBanner(null), 1500);
    }
    const from = this.path.length ? this.path[this.path.length - 1]! : solution[0]!;
    const to = this.path.length ? solution[this.path.length] : solution[1];
    if (to == null) return;
    this.hintsUsed++;
    this.board?.showHint(from, to);
    this.announce(`Hint: go to ${this.describe(to).toLowerCase()}`);
    this.audio.blip();
    this.markDirty();
  }

  // ------------------------------------------------------------ preferences

  setDifficulty(name: DifficultyName): void {
    this.difficulty = name;
    localStorage.setItem('zip.difficulty', name);
    this.newPuzzle();
    this.markDirty();
  }

  cycleSound(): void {
    this.audio.mode = SOUND_MODES[(SOUND_MODES.indexOf(this.audio.mode) + 1) % SOUND_MODES.length]!;
    localStorage.setItem('zip.sound', this.audio.mode);
    this.audio.blip();
    this.markDirty();
  }

  toggleAutoNext(): void {
    this.autoNext = !this.autoNext;
    localStorage.setItem('zip.autoNext', this.autoNext ? 'on' : 'off');
    if (!this.autoNext) clearTimeout(this.advanceTimer);
    this.markDirty();
  }

  cycleTheme(): void {
    this.theme = this.theme === 'system' ? 'light' : this.theme === 'light' ? 'dark' : 'system';
    localStorage.setItem('zip.theme', this.theme);
    this.applyTheme();
    this.markDirty();
  }

  private applyTheme(): void {
    const root = document.documentElement;
    if (this.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', this.theme);
  }

  // ----------------------------------------------------------------- input

  private tipFor(point: { x: number; y: number }): Tip | null {
    if (!this.path.length || this.solved || this.revealed || !this.board || !this.engine) return null;
    const puzzle = this.puzzle!;
    const head = this.path[this.path.length - 1]!;
    const dx = point.x - this.board.cx(head);
    const dy = point.y - this.board.cy(head);
    let ux = 0;
    let uy = 0;
    let reach: number;
    if (Math.abs(dx) >= Math.abs(dy)) { ux = dx < 0 ? -1 : 1; reach = Math.abs(dx); }
    else { uy = dy < 0 ? -1 : 1; reach = Math.abs(dy); }
    if (reach < 1) return null;

    const col = (head % puzzle.cols) + ux;
    const row = ((head / puzzle.cols) | 0) + uy;
    if (col < 0 || row < 0 || col >= puzzle.cols || row >= puzzle.rows) return null;
    const neighbour = row * puzzle.cols + col;
    const retract = this.path.length > 1 && neighbour === this.path[this.path.length - 2];
    // A blocked direction still gives a little, so pushing at a wall feels like
    // resistance rather than a dead control.
    const limit = retract || this.engine.canStep(this.path, this.inPath, neighbour)
      ? U / 2
      : U * 0.13;
    return { ux, uy, amount: Math.min(reach, limit), retract };
  }

  private onPointerDown(e: PointerEvent, svg: SVGSVGElement): void {
    this.audio.markInteracted();
    this.board?.invalidateRect();
    const point = this.board?.toBoard(e.clientX, e.clientY);
    if (!point) return;
    const cell = this.board!.cellAtBoard(point);
    if (cell < 0) return;
    this.drag = { active: true, at: point, tip: null, settle: null };
    svg.setPointerCapture(e.pointerId);
    this.step(cell);
    this.drag.tip = this.tipFor(point);
    this.renderTrail();
    e.preventDefault();
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.drag.active) return;
    const point = this.board?.toBoard(e.clientX, e.clientY);
    if (!point) return;
    // Walk the segment travelled since the last event rather than sampling only
    // its endpoint, so a fast drag cannot jump a cell and stall the line.
    const from = this.drag.at ?? point;
    const span = Math.hypot(point.x - from.x, point.y - from.y);
    const samples = Math.min(32, Math.max(1, Math.ceil(span / (U * 0.34))));
    for (let i = 1; i <= samples; i++) {
      const cell = this.board!.cellAtBoard({
        x: from.x + (point.x - from.x) * i / samples,
        y: from.y + (point.y - from.y) * i / samples
      });
      if (cell >= 0) this.step(cell);
    }
    this.drag.at = point;
    this.drag.tip = this.tipFor(point);
    this.renderTrail();
  }

  private onPointerUp(e: PointerEvent, svg: SVGSVGElement): void {
    if (!this.drag.active) return;
    this.drag.active = false;
    this.drag.settle = this.drag.tip;          // let the tip ease home
    this.drag.tip = null;
    this.drag.at = null;
    if (e.pointerId != null && svg.hasPointerCapture(e.pointerId)) {
      svg.releasePointerCapture(e.pointerId);
    }
  }

  private ownsKeyboard(): boolean {
    const active = document.activeElement;
    return !active || active === document.body || active === this.regionEl;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    this.audio.markInteracted();
    const arrow = ARROWS[e.key];
    if (arrow) {
      // Claiming the arrows unconditionally stopped the page scrolling and
      // hijacked them from focused controls.
      if (!this.ownsKeyboard()) return;
      e.preventDefault();
      if (!this.puzzle) return;
      if (!this.path.length) { this.step(this.puzzle.waypoints[0]!); return; }
      const head = this.path[this.path.length - 1]!;
      const row = ((head / this.puzzle.cols) | 0) + arrow[0];
      const col = (head % this.puzzle.cols) + arrow[1];
      if (row < 0 || col < 0 || row >= this.puzzle.rows || col >= this.puzzle.cols) return;
      this.step(row * this.puzzle.cols + col);
      return;
    }
    const key = e.key.toLowerCase();
    if (key === 'u' || e.key === 'Backspace') { e.preventDefault(); this.pop(); }
    else if (key === 'h') this.hint();
    else if (key === 'r') this.restart();
    else if (key === 'n') this.newPuzzle();
  }

  // ------------------------------------------------- test-only introspection

  /** Exposed on window under ?test so the browser suite can drive a known puzzle. */
  testHooks() {
    const core = this;
    return {
      core,
      load: (puzzle: Puzzle) => core.load(puzzle),
      step: (cell: Cell) => core.step(cell),
      hint: () => core.hint(),
      restart: () => core.restart(),
      newPuzzle: () => core.newPuzzle(),
      audio: core.audio,
      generate: generateDifficulty,
      setMode: (mode: Mode) => core.setMode(mode),
      share: () => core.share(),
      get day() { return core.day; },
      U,
      PAD: 6,
      /*
       * Live accessors, not a snapshot. restart() and load() replace the path
       * and inPath arrays wholesale, so a caller that held the returned object
       * across one of those would otherwise be reading a detached array and
       * quietly disagreeing with the board.
       */
      get state() {
        return {
          get puzzle() { return core.puzzle; },
          get engine() { return core.engine; },
          get path() { return core.path; },
          get inPath() { return core.inPath; },
          get elapsed() { return core.elapsed; },
          get running() { return core.running; },
          get solved() { return core.solved; },
          get difficulty() { return core.difficulty; },
          get mode() { return core.mode; }
        };
      }
    };
  }
}
