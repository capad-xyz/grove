import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CommitNode, WorkingStatus } from '@grove/engine';

import { fileCount, isAway, measureAway } from './seen.ts';

const commit = (id: string): CommitNode => ({
  id,
  short: id.slice(0, 7),
  parents: [],
  author: 'a',
  time: 0,
  refs: [],
  summary: id,
});

const LOG = ['e', 'd', 'c', 'b', 'a'].map(commit); // newest first

const status = (staged = 0, unstaged = 0, untracked = 0): WorkingStatus => ({
  branch: 'main',
  staged: Array.from({ length: staged }, (_, i) => ({ path: `s${i}`, status: 'M' })),
  unstaged: Array.from({ length: unstaged }, (_, i) => ({ path: `u${i}`, status: 'M' })),
  untracked: Array.from({ length: untracked }, (_, i) => `n${i}`),
});

test('fileCount sums all three groups', () => {
  assert.equal(fileCount(null), 0);
  assert.equal(fileCount(status()), 0);
  assert.equal(fileCount(status(1, 2, 3)), 6);
});

test('no mark means nothing is new', () => {
  // First ever look. Flagging all of history as unseen is true and useless.
  assert.deepEqual(measureAway(null, LOG, status(4)), { commits: 0, files: 0 });
});

test('counts commits above the mark', () => {
  assert.equal(measureAway({ sha: 'c', files: 0 }, LOG, null).commits, 2);
  assert.equal(measureAway({ sha: 'e', files: 0 }, LOG, null).commits, 0);
  assert.equal(measureAway({ sha: 'a', files: 0 }, LOG, null).commits, 4);
});

test('a mark whose commit is gone reports everything', () => {
  // Rebased, amended, or fallen past the fetch window. Over-reporting beats
  // silently hiding work an agent did.
  assert.equal(measureAway({ sha: 'zzz', files: 0 }, LOG, null).commits, LOG.length);
});

test('a null sha in a real mark reports no commits', () => {
  // Written when the repo had no commits at all; there is nothing to be above.
  assert.equal(measureAway({ sha: null, files: 0 }, LOG, null).commits, 0);
});

test('reports growth in the working tree', () => {
  assert.equal(measureAway({ sha: 'e', files: 2 }, LOG, status(1, 2, 2)).files, 3);
});

test('a shrinking working tree is not reported as change', () => {
  // The count fell because work got committed — which the commit number already
  // covers. Reporting it again would double-count one event.
  assert.equal(measureAway({ sha: 'e', files: 9 }, LOG, status(1)).files, 0);
});

test('commits and files are reported together', () => {
  const away = measureAway({ sha: 'c', files: 1 }, LOG, status(0, 3, 1));
  assert.deepEqual(away, { commits: 2, files: 3 });
  assert.equal(isAway(away), true);
});

test('isAway is false only when nothing moved', () => {
  assert.equal(isAway({ commits: 0, files: 0 }), false);
  assert.equal(isAway({ commits: 1, files: 0 }), true);
  assert.equal(isAway({ commits: 0, files: 1 }), true);
});

test('an empty log with a live mark reports zero, not a crash', () => {
  assert.deepEqual(measureAway({ sha: 'e', files: 0 }, [], null), { commits: 0, files: 0 });
});
