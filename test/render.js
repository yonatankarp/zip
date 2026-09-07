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

  // --- the two routes to a light palette must agree -------------------------
  // The light tokens are declared twice: once under prefers-color-scheme for
  // system-light viewers, once under [data-theme="light"] for the pin button.
  // If those lists drift, the same user gets two different palettes.
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'light', width: 520, height: 900 });
    await page.goto(URL);
    const TOKENS = ['--bg', '--panel', '--board', '--line', '--ink', '--dim',
                    '--accent', '--accent-ink', '--path', '--wall', '--shadow'];
    const read = `
      var cs = getComputedStyle(document.documentElement);
      return ${JSON.stringify(TOKENS)}.map(function (t) { return t + '=' + cs.getPropertyValue(t).trim(); });`;
    const viaMedia = await page.eval(read);
    const viaPin = await page.eval(
      `document.documentElement.setAttribute('data-theme', 'light'); ` + read);
    for (let i = 0; i < TOKENS.length; i++) {
      ok(viaMedia[i] === viaPin[i],
         `light palette differs by route: system gives "${viaMedia[i]}", pinned gives "${viaPin[i]}"`);
      ok(viaMedia[i].split('=')[1] !== '', `${TOKENS[i]} is empty under system light`);
    }
    await page.close();
  }

  // --- layout holds across the width range ----------------------------------
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    for (const width of [320, 360, 375, 390, 414, 430, 520, 768, 1024]) {
      await page.send('Emulation.setDeviceMetricsOverride',
        { width, height: 900, deviceScaleFactor: 2, mobile: width < 500 });
      await sleep(90);
      const m = await page.eval(`
        var d = document.documentElement, b = document.getElementById('board');
        return {
          scrollW: d.scrollWidth, clientW: d.clientWidth,
          board: b.getBoundingClientRect().width,
          hint: getComputedStyle(document.querySelector('.hint')).display,
          controls: document.getElementById('newBtn').getBoundingClientRect().width
        };`);
      ok(m.scrollW <= m.clientW + 1, `${width}px: page scrolls horizontally (${m.scrollW} > ${m.clientW})`);
      ok(m.board > 120, `${width}px: board collapsed to ${Math.round(m.board)}px`);
      ok(m.controls > 40, `${width}px: buttons collapsed to ${Math.round(m.controls)}px`);
      // The keyboard hint is meaningless on a phone and is meant to drop out.
      if (width <= 380) ok(m.hint === 'none', `${width}px: keyboard hint still shown`);
      else ok(m.hint !== 'none', `${width}px: keyboard hint hidden on a wide screen`);
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

  // --- the line must follow the pointer, not jump a cell at a time ----------
  // This is the property that makes dragging feel like drawing. Sample the tip
  // of the drawn line while easing the pointer across one cell: it should take
  // many distinct positions, in small increments, not two.
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('easy', 5150)); return 1");
    const pts = await page.eval(POINTS);
    const TIP = `
      var s = document.querySelector('#trail').getAttribute('points').trim().split(' ');
      var last = s[s.length - 1].split(',');
      return { x: parseFloat(last[0]), y: parseFloat(last[1]), vertices: s.length };`;

    await page.mouse('mousePressed', pts[0].x, pts[0].y);
    const seen = [];
    const STEPS = 12;
    for (let i = 0; i <= STEPS; i++) {
      await page.mouse('mouseMoved',
        pts[0].x + (pts[1].x - pts[0].x) * i / STEPS,
        pts[0].y + (pts[1].y - pts[0].y) * i / STEPS);
      seen.push(await page.eval(TIP));
    }
    await page.mouse('mouseReleased', pts[1].x, pts[1].y);

    const distinct = new Set(seen.map(s => s.x.toFixed(2) + ',' + s.y.toFixed(2))).size;
    let biggest = 0;
    for (let i = 1; i < seen.length; i++) {
      biggest = Math.max(biggest, Math.hypot(seen[i].x - seen[i - 1].x, seen[i].y - seen[i - 1].y));
    }
    // Cell centres are 100 viewBox units apart; a cell-at-a-time line gives 2
    // distinct positions and a 100-unit jump.
    ok(distinct >= 9, `line took only ${distinct} distinct positions crossing one cell (jumpy)`);
    ok(biggest < 25, `line jumped ${biggest.toFixed(1)} viewBox units in one pointer move`);

    // And releasing must ease the tip home rather than snap it.
    const atRelease = await page.eval(TIP);
    await sleep(400);
    const settled = await page.eval(TIP);
    ok(Math.abs(settled.x - Math.round(settled.x / 50) * 50) < 2 ||
       Math.abs(settled.y - Math.round(settled.y / 50) * 50) < 2,
       'tip did not settle onto the grid after release');
    ok(atRelease.vertices >= 2, 'no line drawn before release');
    await page.close();
  }

  // --- a fast flick along a straight run must not skip cells ----------------
  // A pointer only ever travels the line between two events, so the meaningful
  // case is a fast drag along a straight stretch of the solution: every cell
  // under that line must be picked up, not just the endpoint.
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 2468)); return 1");
    const pts = await page.eval(POINTS);
    // Longest straight stretch of the solution, as row/col indices.
    const run = await page.eval(`
      var s = window.__zip.state.puzzle, sol = s.solution, cols = s.cols;
      var best = { start: 0, end: 0 }, start = 0;
      for (var i = 1; i < sol.length; i++) {
        var straight = i >= 2 &&
          (sol[i] - sol[i - 1]) === (sol[i - 1] - sol[i - 2]);
        if (!straight) start = i - 1;
        if (i - start > best.end - best.start) best = { start: start, end: i };
      }
      return best;`);
    ok(run.end - run.start >= 2, `no straight run found (got ${run.end - run.start})`);

    await page.mouse('mousePressed', pts[0].x, pts[0].y);
    for (let k = 1; k <= run.start; k++) await page.mouse('mouseMoved', pts[k].x, pts[k].y);
    const before = await page.eval("return Number(document.getElementById('filled').textContent)");
    // One single event spanning the whole straight run, as a flick produces.
    await page.mouse('mouseMoved', pts[run.end].x, pts[run.end].y);
    const after = await page.eval("return Number(document.getElementById('filled').textContent)");
    await page.mouse('mouseReleased', pts[run.end].x, pts[run.end].y);
    ok(before === run.start + 1, `setup drag reached ${before}, expected ${run.start + 1}`);
    ok(after === run.end + 1,
       `flick across ${run.end - run.start} cells committed ${after - before} of them`);
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
