import assert from 'node:assert/strict';
import { test } from 'node:test';

import { crumbs } from './crumbs.ts';

test('windows paths keep the drive as a usable root', () => {
  // "C:" alone is a relative path on Windows — it means "current directory on
  // drive C". The trailing slash is what makes the crumb navigable.
  assert.deepEqual(crumbs('C:/Users/capad'), [
    { label: 'C:', path: 'C:/' },
    { label: 'Users', path: 'C:/Users' },
    { label: 'capad', path: 'C:/Users/capad' },
  ]);
});

test('backslashes are accepted', () => {
  assert.deepEqual(
    crumbs(String.raw`C:\Users\capad`).map((c) => c.path),
    ['C:/', 'C:/Users', 'C:/Users/capad'],
  );
});

test('posix paths keep the leading slash as the root crumb', () => {
  assert.deepEqual(crumbs('/home/capad'), [
    { label: '/', path: '/' },
    { label: 'home', path: '/home' },
    { label: 'capad', path: '/home/capad' },
  ]);
});

test('a bare root yields one navigable crumb', () => {
  assert.deepEqual(crumbs('C:/'), [{ label: 'C:', path: 'C:/' }]);
  assert.deepEqual(crumbs('/'), [{ label: '/', path: '/' }]);
});

test('trailing slashes do not produce an empty crumb', () => {
  assert.deepEqual(
    crumbs('C:/Users/capad/').map((c) => c.label),
    ['C:', 'Users', 'capad'],
  );
});

test('an empty path has no crumbs', () => {
  assert.deepEqual(crumbs(''), []);
});

test('every crumb path is a prefix of the one after it', () => {
  const out = crumbs('C:/Users/capad/Desktop/Grove');
  for (let i = 1; i < out.length; i++) {
    assert.ok(
      out[i]!.path.startsWith(out[i - 1]!.path.replace(/\/$/, '')),
      `${out[i]!.path} should extend ${out[i - 1]!.path}`,
    );
  }
});
