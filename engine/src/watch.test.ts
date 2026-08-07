import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classify, isNoisyPath } from './watch.ts';
import { INV_INDEX, INV_REFS, INV_WORKDIR, INV_WORKTREES } from './types.ts';

// These two cases are ported verbatim from the Rust tests in
// `src-tauri/src/repo/watch.rs`; they are the contract the coordinator relies
// on, so they must keep passing across the port.

test('classifies git internals', () => {
  assert.equal(classify(String.raw`C:\r\.git\index`), INV_INDEX);
  assert.equal(classify(String.raw`C:\r\.git\index.lock`), 0);
  assert.equal(classify(String.raw`C:\r\.git\HEAD`), INV_REFS);
  assert.equal(classify(String.raw`C:\r\.git\refs\heads\main`), INV_REFS);
  assert.equal(classify(String.raw`C:\r\.git\packed-refs`), INV_REFS);
  assert.equal(classify(String.raw`C:\r\.git\worktrees\wt1\HEAD`), INV_WORKTREES);
  assert.equal(classify(String.raw`C:\r\.git\objects\ab\cdef`), 0);
  assert.equal(classify(String.raw`C:\r\.git\COMMIT_EDITMSG`), 0);
  assert.equal(classify(String.raw`C:\r\.git`), 0);
});

test('classifies workdir', () => {
  assert.equal(classify(String.raw`C:\r\src\main.rs`), INV_WORKDIR);
  assert.equal(classify(String.raw`C:\r\Cargo.lock`), INV_WORKDIR);
  assert.equal(classify(String.raw`C:\r\node_modules\x\y.js`), 0);
  assert.equal(classify(String.raw`C:\r\target\debug\foo`), 0);
  assert.equal(classify(String.raw`C:\r\dist\bundle.js`), 0);
});

test('posix paths classify the same as windows paths', () => {
  assert.equal(classify('/home/r/.git/index'), INV_INDEX);
  assert.equal(classify('/home/r/.git/refs/heads/main'), INV_REFS);
  assert.equal(classify('/home/r/src/main.ts'), INV_WORKDIR);
  assert.equal(classify('/home/r/node_modules/x/y.js'), 0);
});

test('a lockfile anywhere under .git is ignored', () => {
  assert.equal(classify('/r/.git/refs/heads/main.lock'), 0);
  assert.equal(classify('/r/.git/config.lock'), 0);
});

test('noisy directories are skipped before descending', () => {
  assert.equal(isNoisyPath('/r/node_modules'), true);
  assert.equal(isNoisyPath('/r/node_modules/pkg/index.js'), true);
  assert.equal(isNoisyPath(String.raw`C:\r\target`), true);
  assert.equal(isNoisyPath('/r/src'), false);
  // A source file that merely mentions a noisy name is not itself noise.
  assert.equal(isNoisyPath('/r/src/node_modules_helper.ts'), false);
});
