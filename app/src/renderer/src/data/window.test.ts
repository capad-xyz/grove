import assert from 'node:assert/strict';
import { test } from 'node:test';

import { scrollToShow, totalHeight, visibleRange } from './window.ts';

const ROW = 24;

test('renders the rows on screen plus overscan', () => {
  // 480px viewport at 24px rows shows 20; ceil+1 = 21, plus 6 overscan each way.
  const r = visibleRange(0, 480, ROW, 1000, 6);
  assert.equal(r.start, 0);
  assert.equal(r.end, 27);
});

test('follows the scroll position', () => {
  const r = visibleRange(ROW * 100, 480, ROW, 1000, 6);
  assert.equal(r.start, 94);
  assert.equal(r.end, 127);
});

test('never runs past either end of the list', () => {
  assert.equal(visibleRange(0, 480, ROW, 1000, 6).start, 0);
  const atEnd = visibleRange(ROW * 990, 480, ROW, 1000, 6);
  assert.equal(atEnd.end, 1000);
  assert.ok(atEnd.start < 1000);
});

test('a short list renders entirely', () => {
  const r = visibleRange(0, 480, ROW, 5, 6);
  assert.deepEqual(r, { start: 0, end: 5 });
});

test('degenerate inputs yield an empty range rather than NaN', () => {
  assert.deepEqual(visibleRange(0, 480, ROW, 0), { start: 0, end: 0 });
  assert.deepEqual(visibleRange(0, 480, 0, 100), { start: 0, end: 0 });
  assert.deepEqual(visibleRange(-50, 480, ROW, 100, 0), { start: 0, end: 21 });
});

test('a viewport that straddles a row still renders it', () => {
  // 100px / 24px = 4.17 rows visible, so five must be rendered.
  const r = visibleRange(0, 100, ROW, 1000, 0);
  assert.equal(r.end, 6); // ceil(4.17) + 1
});

test('scrollToShow returns null when the row is already visible', () => {
  assert.equal(scrollToShow(5, 0, 480, ROW), null);
  assert.equal(scrollToShow(19, 0, 480, ROW), null);
});

test('scrolls up to a row above the viewport', () => {
  assert.equal(scrollToShow(10, ROW * 20, 480, ROW), ROW * 10);
});

test('scrolls down by the minimum, not to the centre', () => {
  // Row 20 sits just past a 480px viewport at scrollTop 0: move exactly enough
  // to reveal it. Centring would jump the list under the reader.
  assert.equal(scrollToShow(20, 0, 480, ROW), ROW * 21 - 480);
});

test('totalHeight drives the scrollbar', () => {
  assert.equal(totalHeight(1000, ROW), 24000);
  assert.equal(totalHeight(0, ROW), 0);
  assert.equal(totalHeight(-5, ROW), 0);
});

test('the visible range always covers the viewport', () => {
  // Property check: for any scroll position, every row the viewport can show
  // must be inside the rendered range, or the user sees blank space.
  for (let scroll = 0; scroll < 24000; scroll += 137) {
    const r = visibleRange(scroll, 480, ROW, 1000, 6);
    const firstOnScreen = Math.floor(scroll / ROW);
    const lastOnScreen = Math.min(999, Math.floor((scroll + 480 - 1) / ROW));
    assert.ok(r.start <= firstOnScreen, `start ${r.start} > ${firstOnScreen} at ${scroll}`);
    assert.ok(r.end > lastOnScreen, `end ${r.end} <= ${lastOnScreen} at ${scroll}`);
  }
});
