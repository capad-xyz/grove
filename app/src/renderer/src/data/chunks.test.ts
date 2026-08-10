import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  FIRST_CHUNK,
  NEXT_CHUNK,
  firstCount,
  isComplete,
  nextCount,
  runStaircase,
} from './chunks.ts';

/**
 * A frame clock with a crank. `flush` runs frames until the staircase stops
 * asking for them, so a test asserts on the finished sequence rather than on
 * how many times it had to turn the handle.
 */
function frameClock() {
  const pending = new Map<number, () => void>();
  let next = 1;
  let cancelled = 0;
  return {
    schedule: (run: () => void) => {
      const id = next++;
      pending.set(id, run);
      return id;
    },
    cancel: (id: number) => {
      if (pending.delete(id)) cancelled += 1;
    },
    /** Run one frame. Returns false when nothing was waiting. */
    tick(): boolean {
      const [id, run] = pending.entries().next().value ?? [];
      if (id === undefined) return false;
      pending.delete(id);
      run!();
      return true;
    },
    flush(limit = 10_000): number {
      let frames = 0;
      while (this.tick()) {
        frames += 1;
        if (frames > limit) throw new Error('staircase never terminated');
      }
      return frames;
    },
    get queued() {
      return pending.size;
    },
    get cancelledCount() {
      return cancelled;
    },
  };
}

test('a diff smaller than the first batch mounts whole', () => {
  // The staircase must be invisible for the ordinary case: most commits are a
  // few dozen lines and should never render in two passes.
  assert.equal(firstCount(12), 12);
  assert.equal(firstCount(FIRST_CHUNK), FIRST_CHUNK);
  assert.ok(isComplete(firstCount(12), 12));
});

test('a large diff mounts a bounded prefix first', () => {
  assert.equal(firstCount(30_106), FIRST_CHUNK);
  assert.ok(!isComplete(firstCount(30_106), 30_106));
});

test('an empty or absent patch mounts nothing', () => {
  assert.equal(firstCount(0), 0);
  assert.equal(firstCount(-1), 0);
  assert.equal(nextCount(0, 0), 0);
  // Nothing to mount is trivially finished, or the growth effect would spin.
  assert.ok(isComplete(0, 0));
});

test('each frame adds a batch and stops exactly at the end', () => {
  assert.equal(nextCount(1000, 30_106), 3000);
  assert.equal(nextCount(29_000, 30_106), 30_106);
  // Already there: stays there rather than overshooting past the array.
  assert.equal(nextCount(30_106, 30_106), 30_106);
  assert.equal(nextCount(40_000, 30_106), 30_106);
});

test('the staircase terminates', () => {
  // The real guarantee: repeated application reaches the total and stays, so
  // the per-frame effect can rely on `isComplete` to stop scheduling.
  let mounted = firstCount(30_106);
  let frames = 0;
  while (!isComplete(mounted, 30_106)) {
    mounted = nextCount(mounted, 30_106);
    frames += 1;
    assert.ok(frames < 1000, 'growth failed to terminate');
  }
  assert.equal(mounted, 30_106);
  assert.equal(frames, Math.ceil((30_106 - FIRST_CHUNK) / NEXT_CHUNK));
});

test('the prefix never shrinks', () => {
  // A shrinking count would unmount rows under the reader's cursor.
  for (const at of [0, 1, 999, 1000, 5000, 30_105]) {
    assert.ok(nextCount(at, 30_106) >= at, `shrank at ${at}`);
  }
  // Negative state is treated as nothing mounted, not as a reason to go backwards.
  assert.equal(nextCount(-50, 30_106), NEXT_CHUNK);
});

test('a degenerate step still makes progress', () => {
  // Guards the loop above: a zero or negative step would never terminate.
  assert.equal(nextCount(0, 10, 0), 1);
  assert.equal(nextCount(0, 10, -5), 1);
});

// --- runStaircase, driven by a hand-cranked frame clock --------------------

test('the first batch is emitted before any frame runs', () => {
  // The point of the whole exercise: something is on screen without waiting.
  const clock = frameClock();
  const seen: number[] = [];
  runStaircase(30_106, (n) => seen.push(n), clock.schedule, clock.cancel);
  assert.deepEqual(seen, [FIRST_CHUNK]);
});

test('a diff that fits in one batch never asks for a frame', () => {
  const clock = frameClock();
  const seen: number[] = [];
  runStaircase(42, (n) => seen.push(n), clock.schedule, clock.cancel);
  assert.deepEqual(seen, [42]);
  assert.equal(clock.queued, 0);
});

test('a large diff climbs one batch per frame and reaches every row', () => {
  const clock = frameClock();
  const seen: number[] = [];
  runStaircase(30_106, (n) => seen.push(n), clock.schedule, clock.cancel);
  const frames = clock.flush();

  assert.equal(seen[0], FIRST_CHUNK);
  assert.equal(seen[seen.length - 1], 30_106);
  assert.equal(frames, Math.ceil((30_106 - FIRST_CHUNK) / NEXT_CHUNK));
  // Monotonic, and every step is a full batch except the last.
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i]! > seen[i - 1]!, 'went backwards');
  assert.equal(clock.queued, 0, 'left a frame scheduled after finishing');
});

test('nothing to mount asks for no frames and reports done', () => {
  const clock = frameClock();
  const seen: number[] = [];
  runStaircase(0, (n) => seen.push(n), clock.schedule, clock.cancel);
  assert.deepEqual(seen, [0]);
  assert.equal(clock.queued, 0);
});

test('stopping mid-flight cancels the pending frame and emits no more', () => {
  // This is what unmounting, or switching to another commit, has to do — a
  // staircase left running would keep pushing rows from the previous patch.
  const clock = frameClock();
  const seen: number[] = [];
  const stop = runStaircase(30_106, (n) => seen.push(n), clock.schedule, clock.cancel);

  clock.tick();
  clock.tick();
  const atStop = seen.length;

  stop();
  assert.equal(clock.cancelledCount, 1);
  assert.equal(clock.queued, 0);
  assert.equal(clock.flush(), 0, 'kept running after stop');
  assert.equal(seen.length, atStop, 'emitted after stop');
});

test('stopping after completion is safe', () => {
  const clock = frameClock();
  const stop = runStaircase(5000, () => {}, clock.schedule, clock.cancel);
  clock.flush();
  stop();
  stop();
  assert.equal(clock.queued, 0);
});
