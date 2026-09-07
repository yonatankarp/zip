/*
 * Celebration layer. Particles live in a fixed full-viewport <svg> so a burst is
 * not boxed inside the board, and the whole layer is torn down when it
 * finishes. Waves are scheduled inside the animation loop rather than on
 * timers, so nothing can fire after the layer is gone.
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

const COLOURS = [
  'var(--accent)', 'var(--path)', 'var(--good)', '#ff5f9e', '#8b5cf6', '#ffffff'
];

interface Particle {
  node: SVGElement;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  round: boolean;
}

interface Wave {
  at: number;
  x: number;
  y: number;
  count: number;
  power: number;
}

interface Burst {
  parts: Particle[];
  waves: Wave[];
  start: number;
  last: number;
}

export class Fx {
  private burst: Burst | null = null;

  constructor(private readonly layer: SVGSVGElement) {}

  clear(): void {
    this.burst = null;
    this.layer.replaceChildren();
  }

  get pieceCount(): number { return this.layer.childElementCount; }

  /**
   * `origin` is where the line finished; the later waves come from the lower
   * corners of the board so it lands as a cascade rather than one puff.
   */
  celebrate(origin: { x: number; y: number }, board: DOMRect, isBest: boolean): void {
    this.clear();
    const scale = isBest ? 2 : 1;
    const waves: Wave[] = [
      { at: 0.0, x: origin.x, y: origin.y, count: 46 * scale, power: 1 },
      { at: 0.16, x: board.left + board.width * 0.12, y: board.top + board.height * 0.95, count: 26 * scale, power: 1.25 },
      { at: 0.3, x: board.left + board.width * 0.88, y: board.top + board.height * 0.95, count: 26 * scale, power: 1.25 }
    ];
    if (isBest) {
      waves.push({
        at: 0.48, x: board.left + board.width / 2, y: board.top + board.height * 0.6,
        count: 60, power: 1.5
      });
    }
    const now = performance.now();
    this.burst = { parts: [], waves, start: now, last: now };
  }

  private spawn(wave: Wave): void {
    if (!this.burst) return;
    for (let i = 0; i < wave.count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.5;
      const speed = (260 + Math.random() * 620) * wave.power;
      const size = 5 + Math.random() * 8;
      const round = Math.random() < 0.35;
      const fill = COLOURS[(Math.random() * COLOURS.length) | 0]!;
      const node = document.createElementNS(SVG_NS, round ? 'circle' : 'rect');
      if (round) {
        node.setAttribute('r', String(size / 2));
      } else {
        node.setAttribute('x', String(-size / 2));
        node.setAttribute('y', String(-size / 2));
        node.setAttribute('width', String(size));
        node.setAttribute('height', String(size));
        node.setAttribute('rx', '1.5');
      }
      node.setAttribute('fill', fill);
      this.layer.appendChild(node);
      this.burst.parts.push({
        node, x: wave.x, y: wave.y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        rot: Math.random() * 360, spin: (Math.random() - 0.5) * 900, round
      });
    }
  }

  tick(now: number): void {
    const burst = this.burst;
    if (!burst) return;
    const dt = Math.min(0.05, (now - burst.last) / 1000);
    burst.last = now;
    const life = (now - burst.start) / 1000;

    while (burst.waves.length && life >= burst.waves[0]!.at) this.spawn(burst.waves.shift()!);

    if (life > 2.1) {
      this.clear();
      return;
    }
    const fade = Math.max(0, 1 - Math.max(0, life - 0.9) / 1.2);
    for (const bit of burst.parts) {
      bit.vy += 1500 * dt;
      bit.vx *= 0.995;
      bit.x += bit.vx * dt;
      bit.y += bit.vy * dt;
      bit.rot += bit.spin * dt;
      bit.node.setAttribute('transform', bit.round
        ? `translate(${bit.x},${bit.y})`
        : `translate(${bit.x},${bit.y}) rotate(${bit.rot})`);
      bit.node.setAttribute('opacity', String(fade));
    }
  }
}
