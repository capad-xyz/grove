import assert from 'node:assert/strict';
import { test } from 'node:test';

import { indexFiles, matchFiles, matchStrings, score } from './match.ts';

const PATHS = [
  'src/index.ts',
  'src/index-helpers/thing.ts',
  'app/src/renderer/src/App.tsx',
  'app/src/renderer/src/components/Diff.tsx',
  'engine/src/read.ts',
  'README.md',
];
const INDEX = indexFiles(PATHS);
const at = (p: string) => INDEX.find((e) => e.path === p)!;

test('indexFiles precomputes lowered path and basename', () => {
  const e = at('app/src/renderer/src/App.tsx');
  assert.equal(e.lower, 'app/src/renderer/src/app.tsx');
  assert.equal(e.base, 'app.tsx');
});

test('a file with no directory still gets a basename', () => {
  assert.equal(indexFiles(['README.md'])[0]!.base, 'readme.md');
});

test('basename hits outrank path hits', () => {
  // "index" should surface src/index.ts, not bury it under a directory that
  // happens to contain the word.
  assert.ok(score(at('src/index.ts'), 'index') > score(at('src/index-helpers/thing.ts'), 'index'));
});

test('exact basename beats prefix beats substring', () => {
  const e = at('src/index.ts');
  assert.ok(score(e, 'index.ts') > score(e, 'index'));
  assert.ok(score(e, 'index') > score(e, 'ndex'));
});

test('subsequence matching is the loosest tier', () => {
  const e = at('app/src/renderer/src/App.tsx');
  const sub = score(e, 'aptsx'); // subsequence of the basename? no — of the path
  assert.ok(sub > 0, 'expected a subsequence match');
  assert.ok(sub < score(e, 'app.tsx'), 'subsequence must rank below a real hit');
});

test('no match scores zero', () => {
  assert.equal(score(at('README.md'), 'zzzzq'), 0);
  assert.equal(score(at('README.md'), ''), 0);
});

test('matchFiles ranks best first and respects the limit', () => {
  const hits = matchFiles(INDEX, 'index');
  assert.equal(hits[0]?.path, 'src/index.ts');
  assert.ok(hits.length <= 8);
  assert.equal(matchFiles(INDEX, 'index', 1).length, 1);
});

test('ties break toward the shallower path', () => {
  // Both contain "src"; the shorter path is the more likely target.
  const hits = matchFiles(indexFiles(['a/b/c/src/x.ts', 'src/x.ts']), 'src');
  assert.equal(hits[0]?.path, 'src/x.ts');
});

test('matching is case-insensitive in both directions', () => {
  assert.ok(matchFiles(INDEX, 'APP.TSX').length > 0);
  assert.ok(matchFiles(indexFiles(['SRC/Thing.TS']), 'thing').length > 0);
});

test('an empty or blank query matches nothing', () => {
  assert.deepEqual(matchFiles(INDEX, ''), []);
  assert.deepEqual(matchFiles(INDEX, '   '), []);
});

test('matchStrings filters short lists', () => {
  const branches = ['main', 'reauthor', 'agent/blame-gutter'];
  assert.deepEqual(matchStrings(branches, 'auth'), ['reauthor']);
  assert.deepEqual(matchStrings(branches, 'AGENT'), ['agent/blame-gutter']);
  assert.deepEqual(matchStrings(branches, ''), []);
  assert.equal(matchStrings(branches, 'a', 2).length, 2);
});
