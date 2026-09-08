/*
 * Renders the app icons from the same mark used in the header, so they cannot
 * drift from it. Run after a brand change: node tools/make-icons.js
 */
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { launch, sleep, findChrome } from '../test/browser.js';
import { serve } from '../test/serve.js';

if (!findChrome()) {
  console.error('no Chrome found; cannot render icons');
  process.exit(1);
}

const mark = (inset, radius) => `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; width: 100%; height: 100%; background: #0e1014; }
  svg { display: block; width: 100%; height: 100%; }
</style>
<svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <rect width="32" height="32" rx="${radius}" fill="#0e1014"></rect>
  <rect x="${inset}" y="${inset}" width="${32 - inset * 2}" height="${32 - inset * 2}"
        rx="${Math.max(1, radius - inset / 2)}" fill="#f5b544"></rect>
  <path d="M${9 + inset * 0.6} ${9 + inset * 0.6}h${14 - inset * 1.2}L${9 + inset * 0.6} ${23 - inset * 0.6}h${14 - inset * 1.2}"
        stroke="#14161c" stroke-width="${3.4 - inset * 0.05}" fill="none"
        stroke-linecap="round" stroke-linejoin="round"></path>
</svg>`;

mkdirSync('public', { recursive: true });
const site = await serve('public');

// "any" icons fill the tile; the maskable one keeps its art inside the safe
// zone, because the launcher may crop it to a circle.
const jobs = [
  { file: 'public/icon-192.png', size: 192, inset: 0, radius: 7 },
  { file: 'public/icon-512.png', size: 512, inset: 0, radius: 7 },
  { file: 'public/icon-maskable-512.png', size: 512, inset: 5, radius: 0 }
];

for (const job of jobs) {
  writeFileSync('public/__icon.html', mark(job.inset, job.radius));
  const page = await launch();
  await page.setup({ scheme: 'dark', width: job.size, height: job.size, deviceScaleFactor: 1 });
  await page.goto(`${site.origin}/__icon.html`);
  await sleep(150);
  await page.screenshot(job.file);
  await page.close();
  console.log(`${job.file} (${job.size}x${job.size})`);
}

unlinkSync('public/__icon.html');
await site.close();
process.exit(0);
