/*
 * Generates public/og.png — the card that renders when the link is pasted
 * anywhere. The board in it is not a mock-up: the real app is loaded, a real
 * puzzle is part-solved, and its <svg> is lifted out and dropped into the card
 * layout. The card therefore cannot drift from what the game actually looks
 * like. Run after a visual change: node tools/make-og.js
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import { launch, sleep, findChrome } from '../test/browser.js';
import { serve } from '../test/serve.js';

if (!findChrome()) {
  console.error('no Chrome found; cannot render the card');
  process.exit(1);
}

const SEED = 31337;
const DRAWN = 22;                 // cells of the solution to show, out of 36

const site = await serve('dist');
const page = await launch();
await page.setup({ scheme: 'dark', width: 700, height: 1000 });
await page.goto(`${site.origin}/index.html?test`);
await page.eval('return !!window.__zip');
await page.eval(`
  const z = window.__zip;
  z.setMode('practice');
  z.load(z.generate('medium', ${SEED}));
  return 1;`);
await page.eval(`
  const z = window.__zip, s = z.state.puzzle.solution;
  for (let i = 0; i < ${DRAWN}; i++) z.step(s[i]);
  return 1;`);
await sleep(200);

const board = await page.eval("return document.getElementById('board').outerHTML");
await page.close();

// The dark palette, copied from styles.css, because the lifted SVG paints
// itself entirely through these tokens.
const CARD = `<!doctype html><meta charset="utf-8"><style>
  :root {
    --board: #131720; --line: #272d3a; --ink: #e9edf5; --dim: #868fa3;
    --accent: #f5b544; --accent-ink: #14161c; --path: #4d8bff;
    --path-ink: #ffffff; --wall: #c2cbdd; --good: #35d07f;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; display: flex; align-items: center; gap: 64px;
    padding: 0 72px; background: #0e1014; color: var(--ink); overflow: hidden;
    font: 400 22px/1.5 ui-sans-serif, -apple-system, "SF Pro Text", Inter, system-ui, sans-serif;
  }
  .copy { flex: 1; }
  .brand { display: flex; align-items: center; gap: 16px; margin-bottom: 26px; }
  .brand svg { display: block; }
  .brand span { font-weight: 700; font-size: 44px; letter-spacing: -.02em; }
  h1 { font-weight: 600; font-size: 52px; line-height: 1.16; letter-spacing: -.025em; margin-bottom: 20px; }
  p { color: var(--dim); font-size: 24px; max-width: 24ch; }
  .board { width: 430px; flex: none; }
  .board svg { width: 100%; height: auto; display: block; }
</style>
<div class="copy">
  <div class="brand">
    <svg width="52" height="52" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="var(--accent)"></rect>
      <path d="M9 9h14L9 23h14" stroke="var(--accent-ink)" stroke-width="3.4" fill="none"
            stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <span>Zip</span>
  </div>
  <h1>One path.<br>Every square.<br>In order.</h1>
  <p>A daily puzzle, plus endless practice in four measured difficulties.</p>
</div>
<div class="board">${board}</div>`;

const temp = 'dist/__og.html';
writeFileSync(temp, CARD);

const shot = await launch();
await shot.setup({ scheme: 'dark', width: 1200, height: 630, deviceScaleFactor: 2 });
await shot.goto(`${site.origin}/__og.html`);
await sleep(300);
await shot.screenshot('public/og.png');
await shot.close();

unlinkSync(temp);
await site.close();
console.log('public/og.png written from the live renderer');
process.exit(0);
