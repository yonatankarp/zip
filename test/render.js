/*
 * Real-browser checks. Launches headless Chrome over CDP (see browser.js),
 * loads index.html, and verifies it renders and responds to genuine mouse
 * input -- the one thing the DOM stub in ui.js cannot prove. Skips cleanly if
 * Chrome is not installed. Pass --shots <dir> to also write screenshots.
 */
const { launch, sleep, findChrome } = require('./browser.js');

if (!findChrome()) {
  console.log('render  skipped — no Chrome found (set CHROME=/path/to/chrome)');
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
    ok(/\d:\d\d\.\d/.test(after.text), `win banner has no time in it: "${after.text}"`);
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

  // --- the playful bits actually fire --------------------------------------
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('easy', 8080)); return 1");
    let pts = await page.eval(POINTS);

    // Audio only starts on a user gesture; a real mouse press is one.
    // Silent by default: nothing should make noise, or even build an audio
    // context, until the player opts in.
    ok(await page.eval("return window.__zip.audio.mode === 'off'"), 'sound does not default to off');
    await page.mouse('mousePressed', pts[0].x, pts[0].y);
    await page.mouse('mouseMoved', pts[1].x, pts[1].y);
    ok(await page.eval('return window.__zip.audio.ctx === null'),
       'an AudioContext was built while sound was off');

    // Turned on, a real gesture must leave the context running -- a suspended
    // one is the classic way audio silently does nothing.
    await page.eval("localStorage.setItem('zip.sound','all'); return 1");
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('easy', 8080)); return 1");
    pts = await page.eval(POINTS);
    ok(await page.eval("return window.__zip.audio.mode === 'all'"), 'stored sound mode not restored');
    await page.mouse('mousePressed', pts[0].x, pts[0].y);
    await page.mouse('mouseMoved', pts[1].x, pts[1].y);
    ok(await page.eval('return !!window.__zip.audio.ctx'), 'no AudioContext after a real gesture');
    ok(await page.eval("return window.__zip.audio.ctx.state === 'running'"),
       'AudioContext is suspended, so nothing would be heard');

    // A number swells when reached, then returns to its resting size.
    const numberAt = await page.eval(`
      var z = window.__zip, sol = z.state.puzzle.solution, num = z.state.engine.numAt;
      for (var i = 1; i < sol.length; i++) if (num[sol[i]]) return i;
      return -1;`);
    ok(numberAt > 0, 'no number found along the solution');
    for (let i = 2; i <= numberAt; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
    const swelled = await page.eval(`
      var d = document.querySelectorAll('#board circle');
      var m = 0; d.forEach(function (c) { var r = +c.getAttribute('r'); if (r > 30 && r < 37) m = Math.max(m, r); });
      return m;`);
    ok(swelled > 30, `no number swelled on arrival (largest disc ${swelled})`);
    await sleep(400);
    const rested = await page.eval(`
      var m = 0; document.querySelectorAll('#board circle').forEach(function (c) {
        var r = +c.getAttribute('r'); if (r > 30 && r < 37) m = Math.max(m, r); });
      return m;`);
    ok(rested === 0, `a number stayed swelled at r=${rested}`);

    // Finish it: the win sweep should appear and then clean itself up.
    for (let i = numberAt + 1; i < pts.length; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
    await page.mouse('mouseReleased', pts[pts.length - 1].x, pts[pts.length - 1].y);
    ok(await page.eval("return !!document.getElementById('shine')"), 'no win sweep drawn');
    await sleep(1000);
    ok(await page.eval("return !document.getElementById('shine')"), 'win sweep never cleaned up');
    ok(page.consoleErrors.length === 0, `sound/animation errors: ${page.consoleErrors.join(' | ')}`);

    // The speaker cycles all -> sparse -> off -> all, persisting each step, and
    // the icon shows which of the three you are in.
    const cycle = [
      ['sparse', { near: '', far: 'none', mute: 'none' }, 'true'],
      ['off',    { near: 'none', far: 'none', mute: '' }, 'false'],
      ['all',    { near: '', far: '', mute: 'none' }, 'true']
    ];   // starts from 'all', set above
    for (const [mode, icon, pressed] of cycle) {
      await page.eval("document.getElementById('soundBtn').click(); return 1");
      ok(await page.eval(`return localStorage.getItem('zip.sound') === '${mode}'`),
         `sound mode did not persist as ${mode}`);
      ok(await page.eval(`return window.__zip.audio.mode === '${mode}'`), `mode is not ${mode}`);
      const shown = await page.eval(`return {
        near: document.getElementById('soundWave').style.display,
        far: document.getElementById('soundWaveFar').style.display,
        mute: document.getElementById('soundMute').style.display,
        pressed: document.getElementById('soundBtn').getAttribute('aria-pressed')
      };`);
      ok(shown.near === icon.near && shown.far === icon.far && shown.mute === icon.mute,
         `${mode}: icon shows ${JSON.stringify(shown)}, expected ${JSON.stringify(icon)}`);
      ok(shown.pressed === pressed, `${mode}: aria-pressed is ${shown.pressed}`);
    }
    await page.close();
  }

  // --- every solve celebrates, and a personal best celebrates harder --------
  const burstSize = async (seed, priorBest) => {
    const page = await launch();
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    if (priorBest) await page.eval(`localStorage.setItem('zip.best.medium', '${priorBest}'); return 1`);
    await page.eval(`window.__zip.load(Zip.generateDifficulty('medium', ${seed})); return 1`);
    const pts = await page.eval(POINTS);
    await page.drag(pts);
    await sleep(700);                    // long enough for every wave to land
    const peak = await page.eval("return document.querySelectorAll('#fx > *').length");
    const moved = await page.eval(`
      var first = document.querySelector('#fx > *');
      var t = first && first.getAttribute('transform');
      return !!t && t.indexOf('translate') === 0;`);
    // SVG className is an SVGAnimatedString, not a string.
    const popped = await page.eval(
      "return document.getElementById('board').classList.contains('won')");
    await sleep(1800);
    const after = await page.eval("return document.querySelectorAll('#fx > *').length");
    await page.close();
    return { peak, moved, popped, after };
  };

  {
    // An "ordinary" solve needs an unbeatable record on file -- with nothing
    // stored, the first solve is itself a personal best.
    const plain = await burstSize(1212, 1);
    ok(plain.peak > 50, `an ordinary solve threw only ${plain.peak} pieces`);
    ok(plain.moved, 'burst pieces are not being moved');
    ok(plain.popped, 'the board did not pop on the win');
    ok(plain.after === 0, `burst never cleaned up (${plain.after} pieces left)`);

    // Beating a stored best should be visibly bigger than an ordinary solve.
    const best = await burstSize(1212, 999999);
    ok(best.peak > plain.peak * 1.6,
       `a personal best threw ${best.peak} pieces vs ${plain.peak} for an ordinary solve`);
    ok(best.after === 0, 'personal-best burst never cleaned up');
  }

  // --- the line must not be erasable by a stray movement --------------------
  // Moving the pointer back onto some earlier part of the line used to truncate
  // everything after it, so one careless sweep wiped the board.
  {
    const page = await launch();
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 3141)); return 1");
    const pts = await page.eval(POINTS);

    await page.mouse('mousePressed', pts[0].x, pts[0].y);
    for (let i = 1; i <= 8; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
    const drawn = await page.eval("return Number(document.getElementById('filled').textContent)");
    ok(drawn === 9, `setup drew ${drawn} cells, expected 9`);

    // Land on cells well back along the line: each must be refused outright.
    for (const back of [0, 2, 4]) {
      await page.eval(`window.__zip.step(window.__zip.state.path[${back}]); return 1`);
      const now = await page.eval("return Number(document.getElementById('filled').textContent)");
      ok(now === 9, `touching drawn cell #${back} truncated the line to ${now}`);
    }

    // Retracing, though, must still work: back over the previous cell pops one.
    await page.mouse('mouseMoved', pts[7].x, pts[7].y);
    const one = await page.eval("return Number(document.getElementById('filled').textContent)");
    ok(one === 8, `retracing one cell left ${one}, expected 8`);
    await page.mouse('mouseMoved', pts[6].x, pts[6].y);
    await page.mouse('mouseMoved', pts[5].x, pts[5].y);
    const three = await page.eval("return Number(document.getElementById('filled').textContent)");
    ok(three === 6, `retracing three cells left ${three}, expected 6`);
    await page.mouse('mouseReleased', pts[5].x, pts[5].y);
    await page.close();
  }

  // --- reduced motion drops the decoration, keeps the game ------------------
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900, reducedMotion: true });
    await page.goto(URL);
    await page.eval("localStorage.setItem('zip.best.medium', '999999'); return 1");
    await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 1212)); return 1");
    const pts = await page.eval(POINTS);
    await page.drag(pts);
    await sleep(150);
    ok(await page.eval("return !document.getElementById('shine')"),
       'win sweep ran despite prefers-reduced-motion');
    ok(await page.eval("return document.querySelectorAll('#fx > *').length === 0"),
       'burst ran despite prefers-reduced-motion');
    // The game itself must be unaffected.
    const won = await page.eval(`return {
      filled: Number(document.getElementById('filled').textContent),
      banner: document.getElementById('banner').className
    };`);
    ok(won.filled === 36, `reduced motion broke the solve (${won.filled}/36)`);
    ok(/show/.test(won.banner), 'reduced motion suppressed the win banner');
    await page.close();
  }

  // --- hints: next move, direction, and rescuing a lost board ---------------
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 606)); return 1");

    const dirOf = `
      function dirOf(from, to, cols) {
        var dx = (to % cols) - (from % cols), dy = ((to / cols) | 0) - ((from / cols) | 0);
        return dx === 1 ? 0 : dx === -1 ? 180 : dy === 1 ? 90 : 270;
      }`;
    const readHint = `
      var g = document.getElementById('hint');
      if (!g) return null;
      var arrow = g.querySelector('path'), rect = g.querySelector('rect');
      // Parsed by hand: a regex here would sit inside a template literal and
      // lose its backslashes before it ever reached the page.
      var rot = parseFloat(arrow.getAttribute('transform').split('rotate(')[1]);
      var p = window.__zip.state.puzzle;
      var col = Math.round((parseFloat(rect.getAttribute('x')) - 6) / 100);
      var row = Math.round((parseFloat(rect.getAttribute('y')) - 6) / 100);
      return { rotate: rot, target: row * p.cols + col };`;

    // On an untouched board the hint is the opening move.
    await page.eval('window.__zip.hint(); return 1');
    let h = await page.eval(readHint);
    let want = await page.eval(dirOf + `
      var s = window.__zip.state.puzzle;
      return { target: s.solution[1], rotate: dirOf(s.solution[0], s.solution[1], s.cols) };`);
    ok(h !== null, 'no hint drawn on an empty board');
    ok(h && h.target === want.target, `opening hint points at ${h && h.target}, expected ${want.target}`);
    ok(h && h.rotate === want.rotate, `opening arrow rotated ${h && h.rotate}, expected ${want.rotate}`);

    // Part-way along the real solution, it points at the next cell.
    await page.eval('var z=window.__zip,s=z.state.puzzle.solution;for(var i=0;i<5;i++)z.step(s[i]);return 1');
    ok(await page.eval("return !document.getElementById('hint')"), 'hint did not clear when the player moved');
    await page.eval('window.__zip.hint(); return 1');
    h = await page.eval(readHint);
    want = await page.eval(dirOf + `
      var z = window.__zip, s = z.state.puzzle, n = z.state.path.length;
      return { target: s.solution[n], rotate: dirOf(s.solution[n - 1], s.solution[n], s.cols) };`);
    ok(h && h.target === want.target, `hint points at ${h && h.target}, expected ${want.target}`);
    ok(h && h.rotate === want.rotate, `arrow rotated ${h && h.rotate}, expected ${want.rotate}`);

    // Step somewhere legal but wrong: the board is now unfinishable, so the
    // hint must reset it and show the opening move again.
    // Walk the solution looking for the first place a legal-but-wrong move
    // exists, and take it. Not every square offers one -- walls often leave a
    // single continuation -- so this has to search rather than assume.
    const wrong = await page.eval(`
      var z = window.__zip, st = z.state, eng = st.engine, sol = st.puzzle.solution;
      z.restart();
      z.step(sol[0]);
      for (var i = 1; i < sol.length; i++) {
        var head = st.path[st.path.length - 1], adj = eng.adj[head];
        for (var j = 0; j < adj.length; j++) {
          var c = adj[j];
          if (c !== sol[i] && eng.canStep(st.path, st.inPath, c)) { z.step(c); return i; }
        }
        z.step(sol[i]);
      }
      return -1;`);
    ok(wrong >= 0, 'could not construct an off-track path anywhere in the solution');
    const beforeReset = await page.eval("return Number(document.getElementById('filled').textContent)");
    ok(beforeReset > 1, `off-track path only ${beforeReset} long`);
    await page.eval('window.__zip.hint(); return 1');
    const afterReset = await page.eval("return Number(document.getElementById('filled').textContent)");
    ok(afterReset === 0, `an off-track board was not reset (${afterReset} cells still drawn)`);
    ok(/Off track/i.test(await page.eval("return document.getElementById('bannerText').textContent")),
       'no explanation given when the board was reset');
    h = await page.eval(readHint);
    want = await page.eval(dirOf + `
      var s = window.__zip.state.puzzle;
      return { target: s.solution[1], rotate: dirOf(s.solution[0], s.solution[1], s.cols) };`);
    ok(h && h.target === want.target, 'hint after a reset does not show the opening move');

    // The hint fades on its own.
    await sleep(2900);
    ok(await page.eval("return !document.getElementById('hint')"), 'hint never faded');
    ok(page.consoleErrors.length === 0, `hint errors: ${page.consoleErrors.join(' | ')}`);
    await page.close();
  }

  // --- a hinted solve never sets a record -----------------------------------
  {
    const page = await launch({ port: port++ });
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("localStorage.setItem('zip.best.medium', '999999'); return 1");
    await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 707)); return 1");
    await page.eval('window.__zip.hint(); return 1');
    const pts = await page.eval(POINTS);
    await page.drag(pts);
    await sleep(150);
    const out = await page.eval(`return {
      best: localStorage.getItem('zip.best.medium'),
      sub: document.getElementById('bannerText').textContent
    };`);
    ok(out.best === '999999', `a hinted solve overwrote the best time (now ${out.best})`);
    ok(/hint/i.test(out.sub), `banner did not mention the hint: "${out.sub}"`);
    await page.close();
  }

  // --- the clock belongs to the puzzle, not the attempt ---------------------
  // Restarting must not reset or pause it, or a run going badly could simply be
  // wiped to protect a best time.
  {
    const page = await launch();
    await page.setup({ scheme: 'dark', width: 520, height: 900 });
    await page.goto(URL);
    await page.eval("window.__zip.load(Zip.generateDifficulty('medium', 2727)); return 1");
    const pts = await page.eval(POINTS);

    await page.mouse('mousePressed', pts[0].x, pts[0].y);
    for (let i = 1; i <= 6; i++) await page.mouse('mouseMoved', pts[i].x, pts[i].y);
    await page.mouse('mouseReleased', pts[6].x, pts[6].y);
    await sleep(500);
    const running = await page.eval('return window.__zip.state.elapsed');
    ok(running > 300, `clock only reached ${Math.round(running)}ms before the restart`);

    await page.eval("document.getElementById('restartBtn').click(); return 1");
    const kept = await page.eval('return window.__zip.state.elapsed');
    const cleared = await page.eval("return Number(document.getElementById('filled').textContent)");
    ok(cleared === 0, `restart left ${cleared} cells drawn`);
    ok(kept >= running - 20, `restart reset the clock (${Math.round(running)}ms -> ${Math.round(kept)}ms)`);

    // ...and it keeps ticking while the board sits empty.
    await sleep(500);
    const later = await page.eval('return window.__zip.state.elapsed');
    ok(later > kept + 300, `clock stalled after the restart (${Math.round(kept)} -> ${Math.round(later)})`);
    ok(!/^0:00\.[01]$/.test(await page.eval("return document.getElementById('clock').textContent")),
       'the clock face went back to zero');

    // Finishing from here must bank the whole elapsed time, restart included.
    const pts2 = await page.eval(POINTS);
    await page.drag(pts2);
    await sleep(150);
    const banked = Number(await page.eval("return localStorage.getItem('zip.best.medium')"));
    ok(banked > later, `a restarted solve banked ${banked}ms, less than the ${Math.round(later)}ms already spent`);

    // A new puzzle, though, does start a fresh clock.
    await page.eval("document.getElementById('newBtn').click(); return 1");
    const fresh = await page.eval('return window.__zip.state.elapsed');
    ok(fresh < 100, `a new puzzle inherited ${Math.round(fresh)}ms`);
    ok(await page.eval('return window.__zip.state.running === false'),
       'a new puzzle started its clock before the first move');
    await page.close();
  }

  console.log(failures === 0
    ? `render  ${checks} browser assertions, 0 failures`
    : `render  ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => { console.error('render  ERROR: ' + e.message); process.exit(1); });
