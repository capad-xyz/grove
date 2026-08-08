import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findMatches, segments, step } from './find.ts';

const LINES = [
  ' const dir = workdirOf(path)',
  '-  return gix.discover(dir)',
  '+  return gitRead(dir, args)',
  '',
];

test('finds every occurrence in document order', () => {
  // Four, not three: line 0 holds `dir` twice — the identifier and the one
  // inside `workdirOf`. A find that skipped the second would quietly under-
  // report, which is the failure mode nobody notices until they need it.
  const m = findMatches(LINES, 'dir');
  assert.deepEqual(
    m.map((x) => [x.line, x.start]),
    [
      [0, 7],
      [0, 17],
      [1, 23],
      [2, 18],
    ],
  );
  // Each reported span really is the query.
  for (const x of m) {
    assert.equal(LINES[x.line]!.slice(x.start, x.end).toLowerCase(), 'dir');
  }
});

test('finds several hits on one line', () => {
  const m = findMatches(['dir dir dir'], 'dir');
  assert.equal(m.length, 3);
  assert.deepEqual(m.map((x) => x.start), [0, 4, 8]);
});

test('matching is case-insensitive', () => {
  assert.equal(findMatches(['Return GIT'], 'return').length, 1);
  assert.equal(findMatches(['Return GIT'], 'git').length, 1);
});

test('hits do not overlap', () => {
  // "aa" in "aaaa" is two matches. Overlapping would make the visible
  // highlights disagree with the reported count.
  const m = findMatches(['aaaa'], 'aa');
  assert.equal(m.length, 2);
  assert.deepEqual(m.map((x) => [x.start, x.end]), [[0, 2], [2, 4]]);
});

test('the query is literal, not a pattern', () => {
  // A diff is code. Treating `(` or `.` as regex would surprise everyone.
  assert.equal(findMatches(['workdirOf(path)'], '(path)').length, 1);
  assert.equal(findMatches(['a.b'], '.').length, 1);
  assert.equal(findMatches(['axb'], 'a.b').length, 0);
});

test('an empty query matches nothing', () => {
  assert.deepEqual(findMatches(LINES, ''), []);
});

test('segments split a line into plain and matched runs', () => {
  const m = findMatches(['the dir here'], 'dir');
  const segs = segments('the dir here', m, 0, 0);
  assert.deepEqual(segs, [
    { text: 'the ', hit: false, index: -1 },
    { text: 'dir', hit: true, index: 0 },
    { text: ' here', hit: false, index: -1 },
  ]);
  // Reassembling the segments must reproduce the line exactly, or the diff
  // would render with characters missing.
  assert.equal(segs.map((s) => s.text).join(''), 'the dir here');
});

test('segments handles a match at either edge', () => {
  const lead = segments('dirx', findMatches(['dirx'], 'dir'), 0, 0);
  assert.deepEqual(lead.map((s) => s.hit), [true, false]);

  const trail = segments('xdir', findMatches(['xdir'], 'dir'), 0, 0);
  assert.deepEqual(trail.map((s) => s.hit), [false, true]);

  const whole = segments('dir', findMatches(['dir'], 'dir'), 0, 0);
  assert.deepEqual(whole, [{ text: 'dir', hit: true, index: 0 }]);
});

test('segments returns one plain run when nothing matches', () => {
  assert.deepEqual(segments('nothing', [], 0, 0), [
    { text: 'nothing', hit: false, index: -1 },
  ]);
});

test('segment indices continue the global match numbering', () => {
  // Line 2 holds the third and fourth matches overall.
  const segs = segments('dir dir', findMatches(['x', 'y', 'dir dir'], 'dir'), 2, 0);
  assert.deepEqual(
    segs.filter((s) => s.hit).map((s) => s.index),
    [0, 1],
  );
});

test('step wraps in both directions', () => {
  assert.equal(step(0, 3, 1), 1);
  assert.equal(step(2, 3, 1), 0);
  assert.equal(step(0, 3, -1), 2);
  assert.equal(step(0, 0, 1), 0);
});
