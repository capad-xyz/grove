import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseRange } from './range.ts';

const SIZE = 1000;

test('no header means serve the whole file', () => {
  assert.equal(parseRange(null, SIZE), null);
  assert.equal(parseRange('', SIZE), null);
});

test('a normal range is inclusive on both ends', () => {
  // bytes=0-499 is 500 bytes, not 499. Getting this wrong truncates every
  // chunk by one byte, which corrupts a video without obviously failing.
  assert.deepEqual(parseRange('bytes=0-499', SIZE), { start: 0, end: 499 });
  assert.deepEqual(parseRange('bytes=500-999', SIZE), { start: 500, end: 999 });
});

test('an open-ended range runs to the last byte', () => {
  assert.deepEqual(parseRange('bytes=900-', SIZE), { start: 900, end: 999 });
});

test('a suffix range means the LAST n bytes', () => {
  // "bytes=-500" is not "from 0 to 500". A media element uses this form to read
  // a trailing index — an MP4 with its moov atom at the end is unplayable if
  // this is misread as a prefix.
  assert.deepEqual(parseRange('bytes=-500', SIZE), { start: 500, end: 999 });
  assert.deepEqual(parseRange('bytes=-1', SIZE), { start: 999, end: 999 });
});

test('a suffix longer than the file clamps to the whole file', () => {
  assert.deepEqual(parseRange('bytes=-5000', SIZE), { start: 0, end: 999 });
});

test('an end past the file clamps rather than over-reading', () => {
  assert.deepEqual(parseRange('bytes=900-5000', SIZE), { start: 900, end: 999 });
});

test('a start past the end is unsatisfiable, not a full response', () => {
  // Answering "here is everything" to a request for byte 1000 of a 1000-byte
  // file makes the player seek to the wrong offset instead of failing.
  assert.equal(parseRange('bytes=1000-', SIZE), 'unsatisfiable');
  assert.equal(parseRange('bytes=5000-6000', SIZE), 'unsatisfiable');
});

test('a reversed range is unsatisfiable', () => {
  assert.equal(parseRange('bytes=500-100', SIZE), 'unsatisfiable');
});

test('an empty file cannot satisfy any range', () => {
  assert.equal(parseRange('bytes=0-10', 0), 'unsatisfiable');
  assert.equal(parseRange('bytes=-1', 0), 'unsatisfiable');
  // ...but a request with no range is still fine; it just yields nothing.
  assert.equal(parseRange(null, 0), null);
});

test('a malformed or unsupported header falls back to the whole file', () => {
  // Multipart ranges are legal HTTP that no media element sends. Serving the
  // whole file is correct and safe; inventing a slice would not be.
  assert.equal(parseRange('bytes=0-99,200-299', SIZE), null);
  assert.equal(parseRange('items=0-99', SIZE), null);
  assert.equal(parseRange('bytes=abc', SIZE), null);
  assert.equal(parseRange('bytes=-', SIZE), null);
});

test('whitespace around the header is tolerated', () => {
  assert.deepEqual(parseRange('  bytes=0-9  ', SIZE), { start: 0, end: 9 });
});

test('every satisfiable range stays inside the file', () => {
  // Property check: a slice that runs past the end is a read error at best and
  // a wrong answer at worst.
  for (const header of ['bytes=0-', 'bytes=1-2', 'bytes=-1', 'bytes=-99999', 'bytes=999-']) {
    const r = parseRange(header, SIZE);
    if (r === null || r === 'unsatisfiable') continue;
    assert.ok(r.start >= 0, `${header} start ${r.start}`);
    assert.ok(r.end < SIZE, `${header} end ${r.end}`);
    assert.ok(r.start <= r.end, `${header} reversed`);
  }
});
