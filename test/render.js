/*
 * Real-browser checks. Launches headless Chrome over CDP (see browser.js),
 * loads index.html, and verifies it renders and responds to genuine mouse
 * input -- the one thing the DOM stub in ui.js cannot prove. Skips cleanly if
 * Chrome is not installed. Pass --shots <dir> to also write screenshots.
 */
const fs = require('fs');
const { launch, sleep } = require('./browser.js');

const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!fs.existsSync(CHROME)) {
  console.log('render  skipped — Chrome not found (set CHROME=/path/to/chrome)');
  process.exit(0);
}

const shotDir = process.argv.includes('--shots')
  ? process.argv[process.argv.indexOf('--shots') + 1] : null;

let checks = 0, failures = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL: ' + m); } };
const URL = 'file://' + process.cwd() + '/index.html?test';

// Centre of every solution cell, in client pixels, computed inside the page
// from the live board rect -- so this exercises the real layout, not a model.
const POINTS = `
  var z = window.__zip, p = z.state.puzzle;
  var r = document.getElementById('board').getBoundingClientRect();
  var scale = r.width / (p.cols * z.U + 2 * z.PAD);
  return p.solution.map(function (c) {
    return {
      x: r.left + ((c % p.cols) * z.U + z.U / 2 + z.PAD) * scale,
      y: r.top + (((c / p.cols) | 0) * z.U + z.U / 2 + z.PAD) * scale
    };
  });`;

(async () => {
  let port = 9500;

  // --- renders in both colour schemes, no console errors --------------------
  for (const scheme of ['dark', 'light']) {
    const page = await launch({ port: port++ });
    await page.setup({ scheme, width: 520, height: 900 });
    await page.goto(URL);
    ok(page.consoleErrors.length === 0, `${scheme}: console errors: ${page.consoleErrors.join(' | ')}`);

    const shape = await page.eval(`
      var b = document.getElementById('board');
      var bg = getComputedStyle(document.body).backgroundColor;
      return {
        cells: b.querySelectorAll('line').length,
        numbers: b.querySelectorAll('text').length,
        trail: !!b.querySelector('#trail'),
        viewBox: b.getAttribute('viewBox'),
        boardWidth: b.getBoundingClientRect().width,
        bodyWidth: document.body.getBoundingClientRect().width,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        bg: bg
      };`);
    ok(shape.trail, `${scheme}: no path element rendered`);
    ok(shape.numbers >= 4, `${scheme}: only ${shape.numbers} numbers drawn`);
    ok(shape.boardWidth > 200, `${scheme}: board is ${shape.boardWidth}px wide`);
    ok(shape.scrollW <= shape.clientW + 1, `${scheme}: page scrolls horizontally`);
    // Light and dark must actually differ, or a theme block is not applying.
    ok(/rgb/.test(shape.bg), `${scheme}: body has no resolved background`);
    if (scheme === 'dark') global.__darkBg = shape.bg; else
      ok(shape.bg !== global.__darkBg, 'light and dark render the same background');

    if (shotDir) {
      await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 31337)); return 1");
      await page.eval('var z=window.__zip,s=z.state.puzzle.solution;for(var i=0;i<20;i++)z.step(s[i]);return 1');
      await sleep(120);
      await page.screenshot(`${shotDir}/zip-${scheme}.png`);
    }
    await page.close();
  }

  // --- a genuine mouse drag solves the puzzle -------------------------------
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 4242)); return 1");
    const pts = await page.eval(POINTS);
    ok(pts.length === 36, `expected 36 solution points, got ${pts.length}`);

    await page.drag(pts);
    await sleep(150);
    const after = await page.eval(`return {
      filled: Number(document.getElementById('filled').textContent),
      banner: document.getElementById('banner').className,
      text: document.getElementById('bannerText').textContent,
      clock: document.getElementById('clock').className,
      progress: document.getElementById('progressFill').style.width
    };`);
    ok(after.filled === 36, `mouse drag filled ${after.filled} of 36`);
    ok(/show/.test(after.banner), 'no win banner after a real drag');
    ok(/Solved|best/i.test(after.text), `banner said "${after.text}"`);
    ok(/done/.test(after.clock), 'clock did not stop on the win');
    ok(after.progress === '100%', `progress bar at ${after.progress}`);
    ok(page.consoleErrors.length === 0, `drag produced console errors: ${page.consoleErrors.join(' | ')}`);

    // Auto-next should replace the board on its own.
    await sleep(2200);
    const next = await page.eval(`return {
      filled: Number(document.getElementById('filled').textContent),
      banner: document.getElementById('banner').className
    };`);
    ok(next.filled === 0, `auto-next left ${next.filled} cells drawn`);
    ok(!/show/.test(next.banner), 'auto-next did not clear the banner');
    await page.close();
  }

  // --- dragging back over the previous cell undoes that step ----------------
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('easy', 77)); return 1");
    const pts = await page.eval(POINTS);
    await page.mouse('mousePressed', pts[0].x, pts[0].y);
    for (let i = 1; i <= 5; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
    const drawn = await page.eval("return Number(document.getElementById('filled').textContent)");
    await page.mouse('mouseMoved', pts[4].x, pts[4].y);       // back one cell
    const undone = await page.eval("return Number(document.getElementById('filled').textContent)");
    await page.mouse('mouseReleased', pts[4].x, pts[4].y);
    ok(drawn === 6, `drag drew ${drawn} cells, expected 6`);
    ok(undone === 5, `dragging back left ${undone} cells, expected 5`);
    await page.close();
  }

  console.log(failures === 0
    ? `render  ${checks} browser assertions, 0 failures`
    : `render  ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('render  ERROR: ' + e.message); process.exit(1); });
