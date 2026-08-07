import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isLockError } from './git.ts';

// Ported verbatim from the Rust tests in `src-tauri/src/repo/write.rs`.
// Misclassifying here either drops a legitimate error or retries forever.
test('lock errors are recognised', () => {
  assert.equal(
    isLockError(
      "fatal: Unable to create 'C:/r/.git/index.lock': File exists.\n\nAnother git process seems to be running",
    ),
    true,
  );
  assert.equal(
    isLockError('error: could not lock config file .git/config: index.lock held'),
    true,
  );
  assert.equal(isLockError('fatal: not a git repository'), false);
  assert.equal(isLockError("error: pathspec 'foo' did not match any file(s)"), false);
});
