/*
 * The daily's pure logic: date rollover, seeding, board identity, storage
 * versioning, streaks and history. No browser needed, so these run in
 * milliseconds rather than as part of the slow visual suite.
 */
import { DIFFICULTIES } from '../src/engine/zip.ts';

// daily.ts reaches for localStorage inside its functions, never at import time.
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear()
};

const {
  DAILY_PUZZLE, STORAGE_VERSION, dayNumber, fingerprint, generateDaily, history,
  readProgress, readResult, seedForDay, setClock, shareText, streak, writeProgress, writeResult
} = await import('../src/game/daily.ts');

let checks = 0;
let failures = 0;
const ok = (cond, msg) => { checks++; if (!cond) { failures++; console.log('  FAIL: ' + msg); } };
const at = iso => setClock(() => new Date(iso));

// --- the UTC-midnight boundary ----------------------------------------------
at('2026-01-01T00:00:00Z');
ok(dayNumber() === 1, `epoch day is ${dayNumber()}, expected 1`);
at('2026-01-01T23:59:59Z');
ok(dayNumber() === 1, 'the day flipped before midnight');
at('2026-01-02T00:00:00Z');
ok(dayNumber() === 2, `just after midnight is day ${dayNumber()}, expected 2`);
at('2026-01-02T00:00:01Z');
ok(dayNumber() === 2, 'the second after midnight is not day 2');
// A player at UTC+2 just after their local midnight is still on the previous
// UTC day -- the puzzle turns over at one instant for everyone, not per zone.
setClock(() => new Date('2026-01-02T00:30:00+02:00'));
ok(dayNumber() === 1, 'the day is being computed in local time, not UTC');
at('2026-09-08T12:00:00Z');
ok(dayNumber() === 251, `2026-09-08 is day ${dayNumber()}, expected 251`);

// --- seeding ----------------------------------------------------------------
ok(seedForDay(10) === seedForDay(10), 'seeds are not stable for a day');
ok(seedForDay(10) !== seedForDay(11), 'consecutive days share a seed');
ok(new Set([1, 2, 3, 4, 5].map(seedForDay)).size === 5, 'seeds collide across days');

// --- the board for a day must not move when the tiers are retuned -----------
// This is the regression that motivated freezing DAILY_PUZZLE: the daily used
// to be generated from DIFFICULTIES.medium, so retuning the tiers -- which has
// already happened once -- silently rewrote every past daily.
{
  const seed = seedForDay(251);
  const before = generateDaily(seed);
  ok(!!before, 'the daily generator produced nothing');
  const original = { ...DIFFICULTIES.medium };
  Object.assign(DIFFICULTIES.medium, { waypoints: 12, wallBudget: 2, minGuesses: 0, maxGuesses: 99 });
  const after = generateDaily(seed);
  Object.assign(DIFFICULTIES.medium, original);

  ok(fingerprint(before) === fingerprint(after),
     'retuning the tier table changed the daily board');
  ok(before.waypoints.length === after.waypoints.length,
     `number count moved from ${before.waypoints.length} to ${after.waypoints.length}`);
  ok(Object.isFrozen(DAILY_PUZZLE), 'the daily configuration is not frozen');

  // Same seed twice is the same board; different seeds are not.
  ok(fingerprint(generateDaily(seed)) === fingerprint(before), 'the daily is not deterministic');
  ok(fingerprint(generateDaily(seedForDay(252))) !== fingerprint(before),
     'two different days produced the same board');
}

// --- storage versioning ------------------------------------------------------
store.clear();
at('2026-09-08T12:00:00Z');
writeResult({ day: 251, ms: 41300, backtracks: 2, hinted: false, board: 'abc' });
ok(JSON.parse(store.get('zip.daily.251')).v === STORAGE_VERSION, 'results are not version-stamped');
ok(readResult(251)?.ms === 41300, 'a stamped result did not read back');

// Entries written before versioning share the shape and must still be read.
store.set('zip.daily.250', JSON.stringify({ day: 250, ms: 50000, backtracks: 0, hinted: false }));
ok(readResult(250)?.ms === 50000, 'a legacy unversioned result was discarded');

// Anything from a newer version is not understood, so it is ignored rather
// than half-parsed into today's shape.
store.set('zip.daily.249', JSON.stringify({ v: STORAGE_VERSION + 1, day: 249, ms: 1 }));
ok(readResult(249) === null, 'a result from a future version was trusted');
store.set('zip.daily.248', 'not json at all');
ok(readResult(248) === null, 'malformed storage was not rejected');
store.set('zip.daily.247', JSON.stringify({ day: 247 }));
ok(readResult(247) === null, 'a result missing its time was accepted');

// The first solve of a day is the one that counts.
writeResult({ day: 251, ms: 1, backtracks: 0, hinted: false, board: 'abc' });
ok(readResult(251)?.ms === 41300, 'replaying the daily overwrote the recorded result');

// Progress carries the same guarantees.
store.clear();
writeProgress({ day: 251, board: 'abc', path: [1, 2], elapsed: 500, backtracks: 0, hintsUsed: 0 });
ok(JSON.parse(store.get('zip.progress')).v === STORAGE_VERSION, 'progress is not version-stamped');
ok(readProgress(251)?.path.length === 2, 'progress did not read back');
ok(readProgress(250) === null, "yesterday's progress was offered for today");

// --- streaks ------------------------------------------------------------------
store.clear();
const record = day => writeResult({ day, ms: 40000, backtracks: 0, hinted: false, board: 'x' });
[248, 249, 250].forEach(record);
ok(streak(251) === 3, `a standing streak reads ${streak(251)}, expected 3`);
record(251);
ok(streak(251) === 4, `after solving today the streak is ${streak(251)}, expected 4`);
store.delete('zip.daily.250');
ok(streak(251) === 1, `a missed day did not break the streak (${streak(251)})`);

// --- history ------------------------------------------------------------------
store.clear();
[[248, 52000], [249, 41000], [250, 63000], [251, 47000]].forEach(([day, ms]) =>
  writeResult({ day, ms, backtracks: 0, hinted: false, board: 'x' }));
const summary = history(251, 30);
ok(summary.entries.length === 30, `history returned ${summary.entries.length} days`);
ok(summary.solved === 4, `history counted ${summary.solved} solves`);
ok(summary.best === 41000, `best is ${summary.best}`);
ok(summary.median === 47000, `median is ${summary.median}`);
ok(history(251, 2).entries.length === 2, 'history span is not respected');

// --- share text ---------------------------------------------------------------
const text = shareText({ day: 251, ms: 41300, backtracks: 1, hinted: false }, 5, 'https://example.test/zip/');
ok(text.startsWith('Zip #251'), `share text starts "${text.split('\n')[0]}"`);
ok(text.includes('1 backtrack '.trim()) || /1 backtrack\b/.test(text), 'backtracks not singular');
ok(text.includes('5 day streak'), 'streak missing from share text');
ok(text.includes('https://example.test/zip/'), 'link missing from share text');
ok(/used a hint/.test(shareText({ day: 1, ms: 1, backtracks: 0, hinted: true }, 1, 'u')),
   'a hinted solve is not disclosed when shared');

console.log(failures === 0
  ? `daily   ${checks} assertions, 0 failures`
  : `daily   ${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
