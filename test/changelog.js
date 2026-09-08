/*
 * The changelog as data: versions well-formed and ordered, dates sane, and the
 * generated CHANGELOG.md in step with the source it comes from.
 */
import { readFileSync } from 'node:fs';
import { CURRENT_VERSION, RELEASES } from '../src/changelog.ts';
import { renderMarkdown } from '../tools/make-changelog.js';

let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };

const rank = v => v.split('.').map(Number).reduce((acc, n) => acc * 1000 + n, 0);

ok(RELEASES.length > 0, 'there are no releases');
ok(CURRENT_VERSION === RELEASES[0].version,
   `CURRENT_VERSION is ${CURRENT_VERSION} but the newest release is ${RELEASES[0].version}`);

const seen = new Set();
let previous = Infinity;
let previousDate = '9999-99-99';
for (const release of RELEASES) {
  ok(/^\d+\.\d+\.\d+$/.test(release.version), `"${release.version}" is not a version`);
  ok(!seen.has(release.version), `${release.version} appears twice`);
  seen.add(release.version);

  ok(rank(release.version) < previous,
     `${release.version} is not older than the entry above it`);
  previous = rank(release.version);

  ok(/^\d{4}-\d{2}-\d{2}$/.test(release.date), `${release.version} has date "${release.date}"`);
  ok(!Number.isNaN(Date.parse(release.date)), `${release.version} has an unparseable date`);
  ok(release.date <= previousDate, `${release.version} is dated after the release above it`);
  previousDate = release.date;

  ok(release.summary.length > 0 && release.summary.length < 120,
     `${release.version} summary is ${release.summary.length} characters`);
  ok(release.changes.length > 0, `${release.version} lists no changes`);
  for (const change of release.changes) {
    ok(['added', 'changed', 'fixed'].includes(change.kind),
       `${release.version} has an entry of kind "${change.kind}"`);
    ok(change.text.length > 10, `${release.version} has a suspiciously short entry`);
    // Player-facing: these should not read like commit messages.
    ok(!/\b(refactor|typecheck|assertion|harness|localStorage|viewBox)\b/i.test(change.text),
       `${release.version} entry leaks implementation detail: "${change.text.slice(0, 60)}…"`);
  }
}

// The markdown is generated, so it must match what the source renders.
let onDisk = '';
try { onDisk = readFileSync('CHANGELOG.md', 'utf8'); } catch { /* handled below */ }
ok(onDisk.length > 0, 'CHANGELOG.md is missing');
ok(onDisk === renderMarkdown(),
   'CHANGELOG.md has drifted from src/changelog.ts — run node tools/make-changelog.js');
ok(onDisk.includes(`## ${CURRENT_VERSION}`), 'CHANGELOG.md does not mention the current version');

console.log(failures === 0
  ? `changelog ${checks} assertions, 0 failures`
  : `changelog ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
