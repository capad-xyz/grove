import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  clampSplit,
  commitsWidth,
  cssPercent,
  MIN_BODY,
  MIN_COMMITS,
  MIN_DIFF,
  MIN_STATUS,
  NO_PANES,
  sanePanes,
  statusHeight,
} from './panes.ts';

test('a size inside the band is left alone', () => {
  assert.equal(clampSplit(360, 1000, 200, 260), 360);
});

test('neither block can be dragged to nothing', () => {
  // Dragged past the left edge, and past the right.
  assert.equal(clampSplit(-500, 1000, 200, 260), 200);
  assert.equal(clampSplit(5000, 1000, 200, 260), 740);
});

test('the block being dragged keeps its floor when both cannot fit', () => {
  // 300px of room, 200 + 260 asked for. Squeezing the dragged pane to 40 would
  // leave the user nothing to grab; the other one gives instead.
  assert.equal(clampSplit(250, 300, 200, 260), 200);
  assert.equal(clampSplit(10, 300, 200, 260), 200);
});

test('a non-finite size falls back to the floor rather than propagating NaN', () => {
  assert.equal(clampSplit(Number.NaN, 1000, 200, 260), 200);
  assert.equal(clampSplit(Number.POSITIVE_INFINITY, 1000, 200, 260), 200);
});

test('commitsWidth clamps against the diff pane, not just the body', () => {
  assert.equal(commitsWidth(360, 1200), 360);
  assert.equal(commitsWidth(1190, 1200), 1200 - MIN_DIFF);
  assert.equal(commitsWidth(1, 1200), MIN_COMMITS);
});

test('an unmeasured body yields no size at all', () => {
  // Better to leave the pane where it is than to store a number derived from a
  // container that was not on screen.
  assert.equal(commitsWidth(360, 0), null);
  assert.equal(commitsWidth(360, Number.NaN), null);
});

test('statusHeight converts a dragged pixel height into a fraction', () => {
  assert.equal(statusHeight(200, 800), 0.25);
  assert.equal(statusHeight(272, 800), 0.34); // the design default, in px
});

test('the working tree always leaves the body room to exist', () => {
  assert.equal(statusHeight(9999, 800), (800 - MIN_BODY) / 800);
  assert.equal(statusHeight(0, 800), MIN_STATUS / 800);
  assert.equal(statusHeight(200, 0), null);
});

test('a fraction round-trips back to the pixels it came from', () => {
  for (const total of [400, 700, 1080, 1440]) {
    for (const px of [80, 160, 300, 520]) {
      const f = statusHeight(px, total);
      assert.ok(f !== null);
      const back = f * total;
      // Clamped values will not round-trip, which is the point of clamping.
      const expected = clampSplit(px, total, MIN_STATUS, MIN_BODY);
      assert.ok(Math.abs(back - expected) < 1e-9, `${px}/${total}: ${back} != ${expected}`);
    }
  }
});

test('cssPercent emits a CSS length, not a bare number', () => {
  assert.equal(cssPercent(0.34), '34.000%');
  assert.equal(cssPercent(0.123456), '12.346%');
  assert.equal(cssPercent(1), '100.000%');
});

test('nothing stored means nothing dragged', () => {
  assert.deepEqual(sanePanes(null), NO_PANES);
  assert.deepEqual(sanePanes(undefined), NO_PANES);
  assert.deepEqual(sanePanes('360px'), NO_PANES);
  assert.deepEqual(sanePanes(42), NO_PANES);
});

test('a partial or wrongly typed record keeps whichever half is usable', () => {
  assert.deepEqual(sanePanes({}), NO_PANES);
  assert.deepEqual(sanePanes({ commits: 420 }), { commits: 420, status: null });
  assert.deepEqual(sanePanes({ commits: '420', status: 0.5 }), {
    commits: null,
    status: 0.5,
  });
});

test('stored nonsense is pulled back into a band that can still be rendered', () => {
  // A width dragged on a 4K monitor, reopened docked; a fraction from a
  // corrupted key. Neither may produce a pane that swallows the window.
  assert.deepEqual(sanePanes({ commits: 9000, status: 12 }), {
    commits: 1600,
    status: 0.85,
  });
  assert.deepEqual(sanePanes({ commits: -10, status: 0 }), {
    commits: MIN_COMMITS,
    status: 0.05,
  });
  assert.deepEqual(sanePanes({ commits: Number.NaN, status: Number.NaN }), NO_PANES);
});
