/*
 * Minimal Chrome DevTools Protocol driver -- no dependencies, no Puppeteer.
 * Launches headless Chrome, connects over the built-in WebSocket, and exposes
 * just enough to load the page, emulate a viewport and colour scheme, dispatch
 * real input, read the DOM, and capture screenshots.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME = process.env.CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function launch({ port = 9333 } = {}) {
  if (!fs.existsSync(CHROME)) throw new Error('Chrome not found at ' + CHROME);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'zip-cdp-'));
  const proc = spawn(CHROME, [
    '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--force-device-scale-factor=2',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: ['ignore', 'ignore', 'ignore'] });

  let target = null;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(100);
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then(r => r.json());
      target = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* not up yet */ }
  }
  if (!target) { proc.kill(); throw new Error('Chrome did not expose a debug target'); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let id = 0;
  const pending = new Map();
  const events = [];
  const waiters = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id != null) {
      const p = pending.get(msg.id); pending.delete(msg.id);
      if (p) (msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result));
    } else {
      events.push(msg);
      for (const w of waiters.splice(0)) w(msg);
    }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const mid = ++id;
    pending.set(mid, { res, rej });
    ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
  });

  const page = {
    send, events,
    consoleErrors: [],
    async close() { ws.close(); proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} },

    async setup({ width = 560, height = 960, mobile = false, scheme = 'light' } = {}) {
      await send('Page.enable');
      await send('Runtime.enable');
      await send('Log.enable');
      await send('Emulation.setDeviceMetricsOverride', {
        width, height, deviceScaleFactor: 2, mobile
      });
      await send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: scheme }]
      });
      if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    },

    async goto(url) {
      await send('Page.navigate', { url });
      // Runtime/Log events carry anything the page complained about.
      await sleep(600);
      for (const e of events) {
        if (e.method === 'Runtime.exceptionThrown') {
          page.consoleErrors.push(e.params.exceptionDetails.exception?.description ||
                                  e.params.exceptionDetails.text);
        }
        if (e.method === 'Log.entryAdded' && e.params.entry.level === 'error') {
          page.consoleErrors.push(e.params.entry.text);
        }
        if (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') {
          page.consoleErrors.push(e.params.args.map(a => a.value ?? a.description).join(' '));
        }
      }
    },

    async eval(expr) {
      const r = await send('Runtime.evaluate', {
        expression: `(function(){ ${expr} })()`,
        returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      }
      return r.result.value;
    },

    async mouse(type, x, y) {
      await send('Input.dispatchMouseEvent', {
        type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1,
        clickCount: 1, pointerType: 'mouse'
      });
    },

    async drag(points) {
      await page.mouse('mousePressed', points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) await page.mouse('mouseMoved', points[i].x, points[i].y);
      await page.mouse('mouseReleased', points[points.length - 1].x, points[points.length - 1].y);
    },

    async screenshot(file) {
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(data, 'base64'));
      return file;
    }
  };
  return page;
}

module.exports = { launch, sleep };
