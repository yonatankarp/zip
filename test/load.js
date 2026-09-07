/*
 * The game is a single static index.html, so the tests load it the same way a
 * browser does: pull the inline scripts out and run them. scripts[0] is the
 * engine, scripts[1] is the game. There is no separate module to drift from it.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const FILE = path.join(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(FILE, 'utf8');
const scripts = [...HTML.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);

if (scripts.length !== 2) {
  console.error(`expected 2 inline scripts in index.html, found ${scripts.length}`);
  process.exit(1);
}

// Run the engine alone, with `module` present so its UMD tail exports to Node.
function loadEngine() {
  const sandbox = { module: { exports: {} }, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(scripts[0], sandbox);
  return sandbox.module.exports;
}

module.exports = { HTML, scripts, loadEngine };
