/*
 * Generates CHANGELOG.md from src/changelog.ts, which is the single source of
 * truth. test/changelog.js fails if the file on disk has drifted, so the two
 * cannot quietly disagree.
 *
 *   node tools/make-changelog.js          write CHANGELOG.md
 *   node tools/make-changelog.js --check  exit 1 if it is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { RELEASES } from '../src/changelog.ts';

const LABEL = { added: 'Added', changed: 'Changed', fixed: 'Fixed' };

export function renderMarkdown(releases = RELEASES) {
  const lines = [
    '# Changelog',
    '',
    'Generated from `src/changelog.ts` by `tools/make-changelog.js` — edit that, not this.',
    ''
  ];
  for (const release of releases) {
    lines.push(`## ${release.version} — ${release.date}`, '', release.summary, '');
    for (const kind of ['added', 'changed', 'fixed']) {
      const of = release.changes.filter(c => c.kind === kind);
      if (!of.length) continue;
      lines.push(`### ${LABEL[kind]}`, '');
      for (const change of of) lines.push(`- ${change.text}`);
      lines.push('');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const wanted = renderMarkdown();
  if (process.argv.includes('--check')) {
    let onDisk = '';
    try { onDisk = readFileSync('CHANGELOG.md', 'utf8'); } catch { /* missing */ }
    if (onDisk !== wanted) {
      console.error('CHANGELOG.md is out of date — run: node tools/make-changelog.js');
      process.exit(1);
    }
    console.log('CHANGELOG.md is up to date');
  } else {
    writeFileSync('CHANGELOG.md', wanted);
    console.log(`CHANGELOG.md written (${RELEASES.length} releases)`);
  }
}
