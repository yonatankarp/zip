/*
 * Sound, synthesised from oscillators so the app ships with no audio assets.
 * Off by default: a puzzle you drill in public should not make noise by
 * surprise, and no AudioContext is built until it is asked for.
 */
export type SoundMode = 'all' | 'sparse' | 'off';

export const SOUND_MODES: SoundMode[] = ['all', 'sparse', 'off'];

export const SOUND_LABEL: Record<SoundMode, string> = {
  all: 'Sound: every step',
  sparse: 'Sound: numbers and wins',
  off: 'Sound: off'
};

export class Audio {
  private ctx: AudioContext | null = null;
  /** Browsers reject (and log) haptics before the user has touched the page. */
  private interacted = false;

  constructor(public mode: SoundMode = 'off') {}

  get audible(): boolean { return this.mode !== 'off'; }
  get context(): AudioContext | null { return this.ctx; }

  markInteracted(): void { this.interacted = true; }

  private ensure(): void {
    if (this.ctx || !this.audible) return;
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    try {
      this.ctx = new Ctor();
    } catch {
      this.ctx = null;
    }
  }

  tone(freq: number, delay: number, duration: number, level: number, shape: OscillatorType = 'sine'): void {
    if (!this.ctx) return;
    const at = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = shape;
    osc.frequency.setValueAtTime(freq, at);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(at);
    osc.stop(at + duration + 0.03);
  }

  private buzz(pattern: number | number[]): void {
    if (!this.audible || !this.interacted) return;
    try {
      navigator.vibrate?.(pattern);
    } catch { /* unsupported */ }
  }

  /** A click whose pitch rises as the board fills, so a run has a shape. */
  step(progress: number): void {
    if (this.mode !== 'all') return;           // 'sparse' keeps numbers and wins only
    this.ensure();
    this.tone(280 * Math.pow(2, progress * 1.2), 0, 0.05, 0.028);
  }

  number(index: number): void {
    if (!this.audible) return;
    this.ensure();
    const base = 523.25 * Math.pow(2, Math.min(index, 12) / 12);
    this.tone(base, 0, 0.11, 0.045, 'triangle');
    this.tone(base * 1.5, 0.045, 0.13, 0.022);
    this.buzz(8);
  }

  win(isBest: boolean): void {
    if (!this.audible) return;
    this.ensure();
    const chord = isBest ? [0, 4, 7, 12, 16] : [0, 4, 7, 12];
    chord.forEach((semitone, i) => {
      this.tone(523.25 * Math.pow(2, semitone / 12), i * 0.07, 0.34, 0.045, 'triangle');
    });
    this.buzz([14, 46, 22]);
  }

  blip(): void {
    if (!this.audible) return;
    this.ensure();
    this.tone(660, 0, 0.09, 0.04, 'triangle');
  }
}
