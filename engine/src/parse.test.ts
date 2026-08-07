import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FS,
  RS,
  isBlameHeader,
  parseCommitRecords,
  parsePorcelainStatus,
  parseRawNumstat,
  parseRefs,
  parseWorktreeList,
  splitN,
  trimEndChars,
} from './parse.ts';

test('splitN keeps the remainder in the last field', () => {
  // The reason this helper exists: `split(sep, n)` throws the tail away, which
  // would truncate every commit body at the first separator-free paragraph.
  assert.deepEqual(splitN('a:b:c:d', ':', 3), ['a', 'b', 'c:d']);
  assert.deepEqual('a:b:c:d'.split(':', 3), ['a', 'b', 'c']); // the trap
  assert.deepEqual(splitN('a', ':', 3), ['a']);
  assert.deepEqual(splitN('', ':', 3), ['']);
});

test('trimEndChars strips every trailing occurrence', () => {
  assert.equal(trimEndChars('a\n\n\n', '\n'), 'a');
  assert.equal(trimEndChars('a', '\n'), 'a');
  assert.equal(trimEndChars('\n\n', '\n'), '');
});

test('parseRefs cleans decorations', () => {
  assert.deepEqual(parseRefs('HEAD -> refs/heads/main, tag: refs/tags/v1'), ['main', 'v1']);
  assert.deepEqual(parseRefs('refs/remotes/origin/main'), ['origin/main']);
  assert.deepEqual(parseRefs(''), []);
  assert.deepEqual(parseRefs('  '), []);
});

test('parseCommitRecords reads a log record', () => {
  const rec = ['abc123', 'abc', 'p1 p2', 'Ada', '1700000000', 'HEAD -> refs/heads/main', 'do it'];
  const out = parseCommitRecords(rec.join(FS) + RS);

  assert.equal(out.length, 1);
  assert.deepEqual(out[0], {
    id: 'abc123',
    short: 'abc',
    parents: ['p1', 'p2'],
    author: 'Ada',
    time: 1700000000,
    refs: ['main'],
    summary: 'do it',
  });
});

test('parseCommitRecords skips malformed and empty records', () => {
  assert.deepEqual(parseCommitRecords(''), []);
  assert.deepEqual(parseCommitRecords(`too${FS}few${RS}`), []);

  // git separates records with RS and a newline; the newline must not survive
  // into the next record's first field.
  const a = ['a', 'a', '', 'A', '1', '', 'first'].join(FS);
  const b = ['b', 'b', 'a', 'B', '2', '', 'second'].join(FS);
  const out = parseCommitRecords(`${a}${RS}\n${b}${RS}`);
  assert.equal(out.length, 2);
  assert.equal(out[1]?.id, 'b');
  assert.deepEqual(out[0]?.parents, []);
});

test('parseCommitRecords defaults an unparseable timestamp to 0', () => {
  const rec = ['a', 'a', '', 'A', 'not-a-number', '', 's'].join(FS) + RS;
  assert.equal(parseCommitRecords(rec)[0]?.time, 0);
});

test('isBlameHeader recognises porcelain headers', () => {
  const sha = 'a'.repeat(40);
  assert.equal(isBlameHeader(`${sha} 1 1 3`), true);
  assert.equal(isBlameHeader(`${sha} 1 1`), true);
  assert.equal(isBlameHeader('author Ada Lovelace'), false);
  assert.equal(isBlameHeader(sha), false); // no trailing fields
  assert.equal(isBlameHeader(`${'z'.repeat(40)} 1 1`), false); // not hex
});

test('parseWorktreeList reads porcelain blocks', () => {
  const out = [
    'worktree /r/main',
    'HEAD 1234567890abcdef',
    'branch refs/heads/main',
    '',
    'worktree /r/wt1',
    'HEAD fedcba0987654321',
    'detached',
  ].join('\n');

  const metas = parseWorktreeList(out);
  assert.equal(metas.length, 2);
  assert.deepEqual(metas[0], {
    path: '/r/main',
    head: '1234567',
    branch: 'main',
    detached: false,
  });
  assert.equal(metas[1]?.branch, null);
  assert.equal(metas[1]?.detached, true);
});

test('parseRawNumstat pairs statuses with counts', () => {
  const changes = [
    ':100644 100644 aaa bbb M\tsrc/a.ts',
    ':000000 100644 000 ccc A\tsrc/b.ts',
    '10\t2\tsrc/a.ts',
    '5\t0\tsrc/b.ts',
  ].join('\n');

  assert.deepEqual(parseRawNumstat(changes), [
    { path: 'src/a.ts', status: 'M', additions: 10, deletions: 2 },
    { path: 'src/b.ts', status: 'A', additions: 5, deletions: 0 },
  ]);
});

test('parseRawNumstat treats binary counts as zero and defaults status', () => {
  const changes = ['-\t-\timg.png'].join('\n');
  assert.deepEqual(parseRawNumstat(changes), [
    { path: 'img.png', status: 'M', additions: 0, deletions: 0 },
  ]);
});

test('parsePorcelainStatus splits the three groups', () => {
  const out = ['M  staged.ts', ' M unstaged.ts', 'MM both.ts', '?? new.ts'].join('\n');
  const s = parsePorcelainStatus(out);

  assert.deepEqual(s.staged, [
    { path: 'staged.ts', status: 'M' },
    { path: 'both.ts', status: 'M' },
  ]);
  assert.deepEqual(s.unstaged, [
    { path: 'unstaged.ts', status: 'M' },
    { path: 'both.ts', status: 'M' },
  ]);
  assert.deepEqual(s.untracked, ['new.ts']);
});

test('parsePorcelainStatus takes the new path of a rename', () => {
  const s = parsePorcelainStatus('R  old/name.ts -> new/name.ts');
  assert.deepEqual(s.staged, [{ path: 'new/name.ts', status: 'R' }]);
});
