import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { CommitNode } from '@grove/engine';

import { graphWidth, layoutGraph } from './graph.ts';

/** `c('b', 'a')` = commit b whose parent is a. Newest first in every list. */
const c = (id: string, ...parents: string[]): CommitNode => ({
  id,
  short: id,
  parents,
  author: 'a',
  time: 0,
  refs: [],
  summary: id,
});

test('a linear history stays in one lane', () => {
  const rows = layoutGraph([c('d', 'c'), c('c', 'b'), c('b', 'a'), c('a')]);
  assert.deepEqual(
    rows.map((r) => r.lane),
    [0, 0, 0, 0],
  );
  assert.equal(graphWidth(rows), 1);
  // The root commit ends its lane rather than dangling.
  assert.deepEqual(rows[3]?.outgoing, []);
});

test('a branch tip opens a second lane', () => {
  //   d (lane 0) -> b
  //   e (lane 1) -> b     e is a separate tip
  //   b, a linear below
  const rows = layoutGraph([c('d', 'b'), c('e', 'b'), c('b', 'a'), c('a')]);
  assert.equal(rows[0]?.lane, 0);
  assert.equal(rows[1]?.lane, 1);
  assert.equal(graphWidth(rows), 2);
});

test('lanes converging on one commit collapse into it', () => {
  // Both d and e expect b, so when b arrives the second lane is released.
  const rows = layoutGraph([c('d', 'b'), c('e', 'b'), c('b', 'a'), c('a')]);
  const b = rows[2]!;
  assert.equal(b.lane, 0);
  assert.deepEqual(b.incoming, [0, 1], 'both waiting lanes should feed the node');

  // And the freed lane must not linger.
  assert.equal(graphWidth(rows.slice(2)), 1);
});

test('a merge sends its second parent to its own lane', () => {
  //  m is a merge of a-side and b-side
  const rows = layoutGraph([c('m', 'x', 'y'), c('x', 'r'), c('y', 'r'), c('r')]);
  const m = rows[0]!;
  assert.equal(m.lane, 0);
  assert.equal(m.outgoing.length, 2, 'both parents get a lane');
  assert.deepEqual(m.outgoing, [0, 1]);
  assert.equal(rows[1]?.lane, 0); // first parent stayed columnar
  assert.equal(rows[2]?.lane, 1);
});

test('merge parents sharing a lane are not duplicated', () => {
  // Both parents of m are the same commit (a degenerate but legal shape).
  const rows = layoutGraph([c('m', 'p', 'p'), c('p')]);
  assert.deepEqual(rows[0]?.outgoing, [0], 'one lane, not two');
});

test('an unrelated lane passes straight through', () => {
  const rows = layoutGraph([c('d', 'b'), c('e', 'z'), c('b', 'a'), c('a')]);
  // While b is being drawn, e's lane is still waiting for z.
  const b = rows[2]!;
  assert.ok(b.passThrough.includes(1), `expected lane 1 to pass through, got ${b.passThrough}`);
  assert.ok(!b.passThrough.includes(b.lane), 'a node never passes through its own lane');
});

test('lanes are reused once freed rather than growing forever', () => {
  // Two independent tips that both terminate, then a third tip. The third
  // should reuse a freed column instead of opening lane 2.
  const rows = layoutGraph([c('x'), c('y'), c('z')]);
  assert.deepEqual(
    rows.map((r) => r.lane),
    [0, 0, 0],
  );
  assert.equal(graphWidth(rows), 1);
});

test('every row reports a width covering the lanes it draws', () => {
  const rows = layoutGraph([c('m', 'x', 'y'), c('x', 'r'), c('y', 'r'), c('r')]);
  for (const r of rows) {
    const used = [r.lane, ...r.outgoing, ...r.passThrough];
    assert.ok(r.width > Math.max(...used) - 1, `width ${r.width} too small for ${used}`);
  }
});

test('an empty history lays out to nothing', () => {
  assert.deepEqual(layoutGraph([]), []);
  assert.equal(graphWidth([]), 1);
});

test('a commit whose parent is missing still terminates cleanly', () => {
  // Truncated history: the fetch window cut off `a`, so `b` points at nothing
  // we hold. The lane should stay open rather than crash.
  const rows = layoutGraph([c('b', 'a')]);
  assert.equal(rows[0]?.lane, 0);
  assert.deepEqual(rows[0]?.outgoing, [0]);
});
