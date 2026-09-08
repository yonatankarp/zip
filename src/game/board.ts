/*
 * Imperative SVG renderer for the board.
 *
 * This is deliberately not React. Drawing runs on every pointermove and on
 * every animation frame -- a completed board plus a celebration is hundreds of
 * attribute writes per frame -- which is a mutation workload, not a
 * reconciliation one. React owns the chrome around it; this owns the <svg>.
 */
import type { Cell, Puzzle } from '../engine/zip.ts';

/** viewBox units per cell. */
export const U = 100;
/** Stroke width of the drawn line, in viewBox units. */
export const LINE = 36;

/*
 * The line changes colour as the board fills, so how far through you are is
 * readable at a glance rather than only from the counter. Fixed values rather
 * than theme tokens: the ramp is its own visual language and should look the
 * same in both themes.
 */
const RAMP: Array<[number, number, number]> = [
  [77, 139, 255],    // blue, at the start
  [124, 108, 246],
  [176, 92, 232],
  [255, 95, 158]     // pink, at the last square
];

/** Colour of the line a fraction `t` of the way through the board. */
export function rampColour(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const span = (RAMP.length - 1) * clamped;
  const i = Math.min(RAMP.length - 2, Math.floor(span));
  const f = span - i;
  const from = RAMP[i]!;
  const to = RAMP[i + 1]!;
  const mix = (a: number, b: number) => Math.round(a + (b - a) * f);
  return `rgb(${mix(from[0], to[0])}, ${mix(from[1], to[1])}, ${mix(from[2], to[2])})`;
}
/** viewBox inset on every side, so strokes are not clipped. */
export const PAD = 6;

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface NumberState {
  /** Disc fill: the ramp colour where the line reaches it, or the resting amber. */
  fill: string;
  /** Digit colour, for contrast against the fill. */
  ink: string;
  next: boolean;
}

export interface Tip {
  ux: number;
  uy: number;
  amount: number;
  retract: boolean;
}

interface NumberNode {
  ring: SVGCircleElement;
  disc: SVGCircleElement;
  text: SVGTextElement;
  cell: Cell;
}

interface Pop {
  node: NumberNode;
  start: number;
}

interface Sweep {
  node: SVGPolylineElement;
  start: number;
  span: number;
}

function node<K extends keyof SVGElementTagNameMap>(
  name: K, attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

export class BoardView {
  private puzzle: Puzzle | null = null;
  private trail: SVGPolylineElement | null = null;
  private segments: SVGLineElement[] = [];
  private ink: SVGGElement | null = null;
  private head: SVGCircleElement | null = null;
  private numbers: NumberNode[] = [];
  private pops: Pop[] = [];
  private sweep: Sweep | null = null;
  private hintGroup: SVGGElement | null = null;
  private hintUntil = 0;
  private rect: DOMRect | null = null;

  constructor(private readonly svg: SVGSVGElement) {}

  // ------------------------------------------------------------ geometry

  cx(cell: Cell): number { return ((cell % this.puzzle!.cols) + 0.5) * U; }
  cy(cell: Cell): number { return (((cell / this.puzzle!.cols) | 0) + 0.5) * U; }

  invalidateRect(): void { this.rect = null; }

  private boardRect(): DOMRect | null {
    if (!this.rect) this.rect = this.svg.getBoundingClientRect();
    return this.rect;
  }

  /*
   * The viewBox is inset by PAD on every side, so board pixels are not a plain
   * division of the rect. One scale taken from the width serves both axes --
   * the viewBox aspect matches the element's, so this stays exact. The rect is
   * cached because reading it on every pointermove forces a layout.
   */
  toBoard(clientX: number, clientY: number): { x: number; y: number } | null {
    const puzzle = this.puzzle;
    const rect = this.boardRect();
    if (!puzzle || !rect || !rect.width) return null;
    const scale = rect.width / (puzzle.cols * U + 2 * PAD);
    return {
      x: (clientX - rect.left) / scale - PAD,
      y: (clientY - rect.top) / scale - PAD
    };
  }

  cellAtBoard(point: { x: number; y: number }): Cell {
    const puzzle = this.puzzle!;
    const col = Math.floor(point.x / U);
    const row = Math.floor(point.y / U);
    if (col < 0 || row < 0 || col >= puzzle.cols || row >= puzzle.rows) return -1;
    return row * puzzle.cols + col;
  }

  cellAt(clientX: number, clientY: number): Cell {
    const point = this.toBoard(clientX, clientY);
    return point ? this.cellAtBoard(point) : -1;
  }

  /** Viewport position of a cell's centre, for aiming the celebration. */
  centreInViewport(cell: Cell): { x: number; y: number } | null {
    const rect = this.boardRect();
    const puzzle = this.puzzle;
    if (!rect || !puzzle || !rect.width) return null;
    const scale = rect.width / (puzzle.cols * U + 2 * PAD);
    return {
      x: rect.left + (this.cx(cell) + PAD) * scale,
      y: rect.top + (this.cy(cell) + PAD) * scale
    };
  }

  rectInViewport(): DOMRect | null { return this.boardRect(); }

  // ------------------------------------------------------------ static art

  /**
   * `covered` draws the grid but none of its contents. Blurring the real board
   * was not enough: the numbers still showed through as blobs, which gave away
   * their positions — the very study the reveal gate exists to prevent.
   */
  setPuzzle(puzzle: Puzzle, covered = false): void {
    this.puzzle = puzzle;
    this.pops = [];
    this.sweep = null;
    this.hintGroup = null;
    this.invalidateRect();
    this.svg.classList.remove('won');

    const { rows, cols } = puzzle;
    this.svg.setAttribute('viewBox',
      `${-PAD} ${-PAD} ${cols * U + 2 * PAD} ${rows * U + 2 * PAD}`);
    this.svg.style.aspectRatio = `${cols * U + 2 * PAD} / ${rows * U + 2 * PAD}`;
    this.svg.replaceChildren();

    // One board surface with interior rules, rather than a tray of loose tiles.
    this.svg.appendChild(node('rect', {
      x: 0, y: 0, width: cols * U, height: rows * U, rx: 14,
      fill: 'var(--board)', stroke: 'var(--line)', 'stroke-width': 2
    }));
    const rules = node('g', { stroke: 'var(--line)', 'stroke-width': 1.5 });
    for (let i = 1; i < cols; i++) {
      rules.appendChild(node('line', { x1: i * U, y1: 7, x2: i * U, y2: rows * U - 7 }));
    }
    for (let i = 1; i < rows; i++) {
      rules.appendChild(node('line', { x1: 7, y1: i * U, x2: cols * U - 7, y2: i * U }));
    }
    this.svg.appendChild(rules);

    /*
     * The polyline carries the geometry but paints nothing: it is what the win
     * sweep copies its shape from. The visible line is drawn as one segment per
     * step, because each needs its own colour and an SVG gradient runs across a
     * bounding box rather than along a path.
     */
    this.trail = node('polyline', {
      fill: 'none', stroke: 'none', 'stroke-width': LINE,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', points: ''
    });
    this.svg.appendChild(this.trail);

    this.ink = node('g', {
      id: 'ink', 'stroke-width': LINE, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
    });
    this.segments = [];
    for (let i = 0; i < rows * cols; i++) {
      const segment = node('line', { x1: 0, y1: 0, x2: 0, y2: 0, visibility: 'hidden' });
      this.ink.appendChild(segment);
      this.segments.push(segment);
    }
    this.svg.appendChild(this.ink);

    this.head = node('circle', { r: 0, fill: 'var(--board)' });
    this.svg.appendChild(this.head);

    // Numbers keep their nodes: as the line reaches them they recolour to match
    // it, so it reads as passing through instead of vanishing behind a disc.
    this.numbers = [];
    const group = node('g', {});
    (covered ? [] : puzzle.waypoints).forEach((cell, index) => {
      const ring = node('circle', {
        cx: this.cx(cell), cy: this.cy(cell), r: 40, fill: 'none',
        stroke: 'var(--ink)', 'stroke-width': 5, opacity: 0
      });
      const disc = node('circle', {
        cx: this.cx(cell), cy: this.cy(cell), r: 30, fill: 'var(--accent)'
      });
      const text = node('text', {
        x: this.cx(cell), y: this.cy(cell), 'text-anchor': 'middle',
        'dominant-baseline': 'central', fill: 'var(--accent-ink)',
        'font-size': index + 1 >= 10 ? 31 : 38,
        'font-weight': 700, 'font-family': 'ui-sans-serif, system-ui, sans-serif'
      });
      text.textContent = String(index + 1);
      group.append(ring, disc, text);
      this.numbers.push({ ring, disc, text, cell });
    });
    this.svg.appendChild(group);

    // Walls span the whole shared edge, so which two cells they separate is
    // never in doubt -- short marks floating in a gutter read as decoration.
    const walls = node('g', {
      stroke: 'var(--wall)', 'stroke-width': 9, 'stroke-linecap': 'round'
    });
    for (const [a, b] of (covered ? [] : puzzle.walls)) {
      if (b - a === 1) {
        const x = (b % cols) * U;
        const y = ((a / cols) | 0) * U;
        walls.appendChild(node('line', { x1: x, y1: y + 6, x2: x, y2: y + U - 6 }));
      } else {
        const y = ((b / cols) | 0) * U;
        const x = (a % cols) * U;
        walls.appendChild(node('line', { x1: x + 6, y1: y, x2: x + U - 6, y2: y }));
      }
    }
    this.svg.appendChild(walls);
  }

  // --------------------------------------------------------------- drawing

  /** `flat` overrides the ramp — used when the board is solved or revealed. */
  drawTrail(path: readonly Cell[], tip: Tip | null, flat: string | null): void {
    if (!this.trail || !this.head || !this.puzzle) return;
    const total = this.puzzle.rows * this.puzzle.cols;
    let upto = path.length;
    // While retracting, drop the head vertex: otherwise the stroke doubles back
    // over itself and the line never looks like it is shortening.
    if (tip?.retract && upto > 1) upto--;

    const xs: number[] = [];
    const ys: number[] = [];
    for (let i = 0; i < upto; i++) {
      xs.push(this.cx(path[i]!));
      ys.push(this.cy(path[i]!));
    }
    if (tip && path.length) {
      const head = path[path.length - 1]!;
      xs.push(this.cx(head) + tip.ux * tip.amount);
      ys.push(this.cy(head) + tip.uy * tip.amount);
    }

    const points: string[] = [];
    for (let i = 0; i < xs.length; i++) points.push(`${xs[i]},${ys[i]}`);
    this.trail.setAttribute('points', points.join(' '));

    for (let i = 0; i < this.segments.length; i++) {
      const segment = this.segments[i]!;
      if (i + 1 >= xs.length) {
        segment.setAttribute('visibility', 'hidden');
        continue;
      }
      segment.setAttribute('x1', String(xs[i]));
      segment.setAttribute('y1', String(ys[i]));
      segment.setAttribute('x2', String(xs[i + 1]));
      segment.setAttribute('y2', String(ys[i + 1]));
      segment.setAttribute('stroke', flat ?? rampColour(i / Math.max(1, total - 1)));
      segment.setAttribute('visibility', 'visible');
    }

    if (path.length) {
      this.head.setAttribute('cx', String(xs[xs.length - 1]));
      this.head.setAttribute('cy', String(ys[ys.length - 1]));
      this.head.setAttribute('r', '10');  // a dot inside the stroke marks where you are
    } else {
      this.head.setAttribute('r', '0');
    }
  }

  /*
   * Numbers the line has passed through take the colour the line has there, so
   * the whole route reads as one continuous thing. The number you are heading
   * for is ringed in the colour the line will be when it arrives -- a different
   * colour each time, which is what makes it obvious rather than decorative.
   */
  drawNumbers(states: readonly NumberState[], nextColour: string): void {
    this.numbers.forEach((entry, index) => {
      const state = states[index];
      if (!state) return;
      entry.disc.setAttribute('fill', state.fill);
      entry.text.setAttribute('fill', state.ink);
      if (state.next) {
        entry.ring.setAttribute('stroke', nextColour);
        entry.ring.setAttribute('opacity', '1');
      } else {
        entry.ring.setAttribute('opacity', '0');
      }
    });
  }

  /** A reached number swells briefly: a milestone you do not have to look for. */
  popNumber(index: number): void {
    const entry = this.numbers[index];
    if (entry) this.pops.push({ node: entry, start: performance.now() });
  }

  /*
   * On a solve, a bright dash runs the length of the finished route once. It is
   * a decorative overlay above the real line, so it cannot affect state -- if
   * the frames never run, nothing is lost.
   */
  startSweep(pathLength: number): void {
    if (!this.trail) return;
    const span = (pathLength - 1) * U + 160;
    const shine = node('polyline', {
      fill: 'none', stroke: 'var(--path-ink)', 'stroke-width': 22,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0.8,
      points: this.trail.getAttribute('points') ?? '',
      'stroke-dasharray': `80 ${span}`, 'stroke-dashoffset': span
    });
    shine.setAttribute('data-shine', '');
    this.svg.appendChild(shine);
    this.sweep = { node: shine, start: performance.now(), span };
  }

  pop(): void {
    this.svg.classList.remove('won');
    void this.svg.getBoundingClientRect();     // restart it if already mid-flight
    this.svg.classList.add('won');
  }

  // ----------------------------------------------------------------- hints

  showHint(from: Cell, to: Cell): void {
    this.clearHint();
    const puzzle = this.puzzle!;
    const group = node('g', {});
    group.setAttribute('data-hint', '');
    // The square to go to, and an arrow at the edge between the two pointing
    // into it -- direction is what you actually need, not just a target.
    group.appendChild(node('rect', {
      x: (to % puzzle.cols) * U + 6, y: ((to / puzzle.cols) | 0) * U + 6,
      width: U - 12, height: U - 12, rx: 12, fill: 'var(--accent)', opacity: 0.22
    }));
    const dx = (to % puzzle.cols) - (from % puzzle.cols);
    const dy = ((to / puzzle.cols) | 0) - ((from / puzzle.cols) | 0);
    const rotate = dx === 1 ? 0 : dx === -1 ? 180 : dy === 1 ? 90 : 270;
    group.appendChild(node('path', {
      d: 'M -13 -15 L 8 0 L -13 15', fill: 'none', stroke: 'var(--accent)',
      'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      transform: `translate(${(this.cx(from) + this.cx(to)) / 2},${(this.cy(from) + this.cy(to)) / 2}) rotate(${rotate})`
    }));
    this.svg.appendChild(group);
    this.hintGroup = group;
    this.hintUntil = performance.now() + 2600;
  }

  clearHint(): void {
    this.hintGroup?.remove();
    this.hintGroup = null;
  }

  // ------------------------------------------------------------ animation

  /** Advance the decorative animations. Returns nothing the game depends on. */
  tick(now: number): void {
    if (this.pops.length) {
      this.pops = this.pops.filter(pop => {
        const k = (now - pop.start) / 240;
        if (k >= 1) {
          pop.node.disc.setAttribute('r', '30');
          return false;
        }
        pop.node.disc.setAttribute('r', String(30 + 9 * Math.sin(Math.PI * k)));
        return true;
      });
    }
    if (this.sweep) {
      const progress = (now - this.sweep.start) / 800;
      if (progress >= 1) {
        this.sweep.node.remove();
        this.sweep = null;
      } else {
        this.sweep.node.setAttribute('stroke-dashoffset', String(this.sweep.span * (1 - progress)));
        this.sweep.node.setAttribute('opacity', String(0.8 * (1 - progress * progress)));
      }
    }
    if (this.hintGroup && now > this.hintUntil) this.clearHint();
  }
}
