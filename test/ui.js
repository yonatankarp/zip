/*
 * Runs the real browser UI under a hand-rolled DOM stub -- no jsdom, no Chrome.
 * Drives index.html's own pointer handlers with coordinates computed from the
 * SVG viewBox geometry, so hit-testing, rendering and the win path all execute.
 * Usage: node test/ui.js [puzzlesPerTier]
 */
const vm = require('vm');
const { scripts, loadEngine } = require('./load.js');

const N = parseInt(process.argv[2] || '15', 10);

const BOARD_PX = 520;
let checks = 0, failures = 0;
const ok = (c, m) => { checks++; if (!c) { failures++; console.log('  FAIL: ' + m); } };

const Engine = loadEngine();
const cache = new Map();
function puzzleFor(tier, i) {
  const key = tier + '#' + i;
  if (!cache.has(key)) cache.set(key, Engine.generateDifficulty(tier, 900000 + i));
  return cache.get(key);
}

function makeDom() {
  const byId = new Map();
  const listeners = new Map();
  const rect = { left: 0, top: 0, width: BOARD_PX, height: BOARD_PX };

  function makeEl(tag) {
    const attrs = {};
    const el = {
      tagName: tag, children: [], style: {}, textContent: '', _html: '',
      classes: new Set(),
      setAttribute(k, v) { attrs[k] = String(v); if (k === 'id') byId.set(String(v), el); },
      getAttribute(k) { return attrs[k]; },
      appendChild(c) { el.children.push(c); return c; },
      querySelector(sel) { return byId.get(sel.replace('#', '')) || null; },
      addEventListener(t, fn) { (listeners.get(el) || listeners.set(el, {}).get(el))[t] = fn; },
      getBoundingClientRect: () => rect,
      setPointerCapture() {}, releasePointerCapture() {}, hasPointerCapture: () => false,
      classList: {
        add: c => el.classes.add(c), remove: c => el.classes.delete(c),
        contains: c => el.classes.has(c),
        toggle: (c, on) => (on === undefined ? (el.classes.has(c) ? el.classes.delete(c) : el.classes.add(c))
                                             : (on ? el.classes.add(c) : el.classes.delete(c)))
      },
      get innerHTML() { return el._html; },
      set innerHTML(v) { el._html = v; if (v === '') { el.children.length = 0; } }
    };
    listeners.set(el, {});
    return el;
  }

  const ids = ['clock', 'tiers', 'board', 'banner', 'bannerText', 'newBtn', 'restartBtn',
               'undoBtn', 'revealBtn', 'filled', 'total', 'tierStats', 'best',
               'progressFill', 'themeBtn', 'autoBtn', 'session'];
  for (const id of ids) { const e = makeEl('div'); e.setAttribute('id', id); }
  const root = makeEl('html');
  root.removeAttribute = k => { delete root._attrs; };
  const doc = {
    documentElement: root,
    getElementById: id => byId.get(id) || null,
    createElement: makeEl,
    createElementNS: (ns, tag) => makeEl(tag),
    addEventListener(t, fn) { (listeners.get(doc) || listeners.set(doc, {}).get(doc))[t] = fn; }
  };
  listeners.set(doc, {});

  const store = new Map();
  const sandbox = {
    document: doc, console,
    location: { search: '' },              // no ?test hook under the stub
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v))
    },
    performance: { now: () => sandbox.__clock },
    requestAnimationFrame: (fn) => { sandbox.__raf = fn; return 1; },
    // Short timers (paint deferral, prefetch) run inline. Long ones -- the
    // auto-next delay -- are queued so a solve assertion is not raced by the
    // next puzzle loading on top of it.
    setTimeout: (fn, ms) => {
      if ((ms || 0) < 1000) { fn(); return 0; }
      sandbox.__timers.push(fn);
      return sandbox.__timers.length;
    },
    clearTimeout: (id) => { if (id) sandbox.__timers[id - 1] = null; },
    __clock: 0, __raf: null, __timers: []
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  // Run one animation frame, the way the browser would.
  sandbox.__pump = () => { const f = sandbox.__raf; sandbox.__raf = null; if (f) f(); };
  sandbox.__flush = () => { const t = sandbox.__timers.splice(0); t.forEach(f => f && f()); };
  return { sandbox, byId, listeners, rect, doc };
}

/*
 * Boot the page. `supply` (optional) replaces the generator BEFORE the UI script
 * runs, so the puzzle the page boots with -- and the one it prefetches -- is ours.
 */
function boot(supply, difficulty) {
  const dom = makeDom();
  const ctx = vm.createContext(dom.sandbox);
  if (difficulty) ctx.localStorage.setItem('zip.difficulty', difficulty);
  vm.runInContext(scripts[0], ctx);            // engine
  if (supply) {
    const real = ctx.Zip.generateDifficulty;
    ctx.Zip.generateDifficulty = (name, seed) => supply(name, seed) || real(name, seed);
  }
  vm.runInContext(scripts[1], ctx);            // ui (boots and renders immediately)
  return dom;
}

// Visual centre of a cell, in client pixels, derived from the viewBox directly.
function centre(cell, p, rect, PAD = 6, U = 100) {
  const scale = rect.width / (p.cols * U + 2 * PAD);
  const vx = (cell % p.cols) * U + U / 2, vy = ((cell / p.cols) | 0) * U + U / 2;
  return { x: rect.left + (vx + PAD) * scale, y: rect.top + (vy + PAD) * scale };
}

function currentPuzzle(dom) {
  // The board's rendered geometry tells us the grid; the engine tells us the rest.
  const vb = dom.byId.get('board').getAttribute('viewBox').split(' ').map(Number);
  return { cols: Math.round((vb[2] - 12) / 100), rows: Math.round((vb[3] - 12) / 100) };
}

// Aim points inside a cell, as fractions of the cell box. The corner aims are
// what make this test meaningful: the hit test must be exact to the cell
// boundary. Ignoring the viewBox padding shifts boundaries by up to PAD/U (6%)
// of a cell, so aiming 2% inside an edge catches it while the centre does not.
const AIMS = {
  centre: [0.5, 0.5],
  topleft: [0.02, 0.02],
  bottomright: [0.98, 0.98]
};

function aimAt(cell, p, rect, aim, PAD = 6, U = 100) {
  const scale = rect.width / (p.cols * U + 2 * PAD);
  const vx = (cell % p.cols) * U + aim[0] * U;
  const vy = ((cell / p.cols) | 0) * U + aim[1] * U;
  return { x: rect.left + (vx + PAD) * scale, y: rect.top + (vy + PAD) * scale };
}

// Drag the whole solution through the page's real pointer handlers.
function playSolution(dom, puzzle, aim) {
  const board = dom.byId.get('board');
  const h = dom.listeners.get(board);
  const n = puzzle.rows * puzzle.cols;
  const first = aimAt(puzzle.solution[0], puzzle, dom.rect, aim);
  dom.sandbox.__clock = 1000;
  h.pointerdown({ clientX: first.x, clientY: first.y, pointerId: 1, preventDefault() {} });
  for (let k = 1; k < n; k++) {
    const c = aimAt(puzzle.solution[k], puzzle, dom.rect, aim);
    dom.sandbox.__clock = 1000 + k * 40;
    h.pointermove({ clientX: c.x, clientY: c.y, pointerId: 1 });
  }
  h.pointerup({ pointerId: 1 });
  dom.sandbox.__pump();
}

function fitRect(dom, puzzle) {
  dom.rect.height = BOARD_PX * (puzzle.rows * 100 + 12) / (puzzle.cols * 100 + 12);
}

// --- 1. full solves driven through the real pointer handlers ------------------
for (const tier of ['easy', 'medium', 'hard', 'expert']) {
  const done = {};
  for (const name of Object.keys(AIMS)) done[name] = 0;
  for (let i = 0; i < N; i++) {
    for (const [name, aim] of Object.entries(AIMS)) {
      const dom = boot(() => puzzleFor(tier, i), tier);
      const ctx = dom.sandbox;
      const puzzle = puzzleFor(tier, i);
      const n = puzzle.rows * puzzle.cols;
      fitRect(dom, puzzle);

      ok(Number(dom.byId.get('total').textContent) === n, `${tier}#${i}/${name}: total cells not rendered`);
      ok(dom.byId.get('board').children.length > 0, `${tier}#${i}/${name}: board rendered nothing`);

      playSolution(dom, puzzle, aim);

      const filled = Number(dom.byId.get('filled').textContent);
      ok(filled === n, `${tier}#${i}/${name}: drag filled ${filled} of ${n} cells`);
      const banner = dom.byId.get('banner');
      ok(banner.classes.has('show'), `${tier}#${i}/${name}: no win banner`);
      ok(/Solved|best/i.test(dom.byId.get('bannerText')._html),
         `${tier}#${i}/${name}: banner said "${dom.byId.get('bannerText')._html}"`);
      ok(dom.byId.get('clock').classes.has('done'), `${tier}#${i}/${name}: clock not stopped`);
      ok(/^\d+:\d\d\.\d$/.test(dom.byId.get('clock').textContent),
         `${tier}#${i}/${name}: clock reads "${dom.byId.get('clock').textContent}"`);
      ok(ctx.localStorage.getItem('zip.best.' + tier) !== null, `${tier}#${i}/${name}: best time not stored`);
      if (filled === n && banner.classes.has('show')) done[name]++;

      dom.byId.get('undoBtn').onclick();
      ok(Number(dom.byId.get('filled').textContent) === n - 1, `${tier}#${i}/${name}: undo did not retract one cell`);
      dom.byId.get('restartBtn').onclick();
      ok(Number(dom.byId.get('filled').textContent) === 0, `${tier}#${i}/${name}: restart did not clear`);
      dom.byId.get('revealBtn').onclick();
      ok(Number(dom.byId.get('filled').textContent) === n, `${tier}#${i}/${name}: reveal did not show the solution`);
    }
  }
  console.log(`${tier.padEnd(7)} solved end-to-end — ` +
    Object.entries(done).map(([k, v]) => `${k} ${v}/${N}`).join(', '));
}

// --- 2. keyboard play --------------------------------------------------------
{
  const tier = 'easy';
  const puzzle = puzzleFor(tier, 0);
  const dom = boot(() => puzzle, tier);
  fitRect(dom, puzzle);
  const keydown = dom.listeners.get(dom.doc).keydown;
  const n = puzzle.rows * puzzle.cols;
  const KEY = { '-1': 'ArrowUp', '1': 'ArrowDown' };
  keydown({ key: 'ArrowRight', preventDefault() {} });     // opens the path on "1"
  ok(Number(dom.byId.get('filled').textContent) === 1, 'arrow key did not open the path');
  for (let k = 1; k < n; k++) {
    const d = puzzle.solution[k] - puzzle.solution[k - 1];
    const key = d === 1 ? 'ArrowRight' : d === -1 ? 'ArrowLeft' : KEY[String(d / puzzle.cols)];
    keydown({ key, preventDefault() {} });
  }
  ok(Number(dom.byId.get('filled').textContent) === n, 'keyboard play did not fill the grid');
  ok(dom.byId.get('banner').classes.has('show'), 'keyboard solve did not win');
  keydown({ key: 'u', preventDefault() {} });
  ok(Number(dom.byId.get('filled').textContent) === n - 1, 'U did not undo');
  console.log('keys    solved end-to-end with arrow keys');
}

// --- 3. the "filled but wrong ending" branch must actually fire ---------------
{
  let fired = false, checked = false;
  for (let seed = 0; seed < 400 && !fired; seed++) {
    const probe = Engine;
    const puzzle = probe.generateDifficulty('easy', 700000 + seed);
    const n = puzzle.rows * puzzle.cols;
    const eng = probe.makeEngine(puzzle);

    // Search, using only canStep, for a full cover that does NOT end on the last
    // number -- the exact state the error banner is meant to catch.
    const inPath = new Uint8Array(n), p = [];
    let bad = null;
    (function dfs() {
      if (bad) return;
      if (p.length === n) { if (!eng.validate(p)) bad = p.slice(); return; }
      for (let c = 0; c < n; c++) {
        if (!eng.canStep(p, inPath, c)) continue;
        p.push(c); inPath[c] = 1;
        dfs();
        inPath[p.pop()] = 0;
        if (bad) return;
      }
    })();
    if (!bad) continue;

    const dom = boot(() => puzzle, 'easy');
    fitRect(dom, puzzle);
    playSolution(dom, { ...puzzle, solution: bad }, AIMS.centre);
    ok(Number(dom.byId.get('filled').textContent) === n, 'wrong-ending case did not fill the grid');
    ok(/must end on the last number/.test(dom.byId.get('bannerText')._html),
       `wrong-ending banner did not fire, got "${dom.byId.get('bannerText')._html}"`);
    ok(dom.sandbox.localStorage.getItem('zip.best.easy') === null, 'a wrong solve recorded a best time');
    fired = true; checked = true;
  }
  ok(fired, 'could not construct a filled-but-wrong path to test the error branch');
  if (checked) console.log('error   filled-but-wrong-ending branch fires and scores nothing');
}

console.log(failures === 0 ? `\nOK — ${checks.toLocaleString()} UI assertions, 0 failures.` : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
