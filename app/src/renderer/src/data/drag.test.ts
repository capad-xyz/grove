import assert from 'node:assert/strict';
import { test } from 'node:test';

import { coalesceDrag } from './drag.ts';

/** A hand-cranked frame scheduler, so a test can decide when a frame happens. */
function scheduler() {
  const queued = new Map<number, () => void>();
  let next = 1;
  return {
    schedule: (fn: () => void) => {
      const id = next++;
      queued.set(id, fn);
      return id;
    },
    cancel: (id: number) => void queued.delete(id),
    /** Run every callback waiting on the next frame. */
    frame() {
      const due = [...queued.values()];
      queued.clear();
      for (const fn of due) fn();
    },
    get waiting() {
      return queued.size;
    },
  };
}

test('many moves within one frame emit once, with the newest position', () => {
  const s = scheduler();
  const seen: number[] = [];
  const drag = coalesceDrag((p) => seen.push(p), s.schedule, s.cancel);

  for (const p of [100, 101, 104, 110, 117]) drag.move(p);
  assert.deepEqual(seen, [], 'nothing emits before the frame runs');

  s.frame();
  assert.deepEqual(seen, [117], 'one emit, carrying the last position');
});

test('each frame emits at most once', () => {
  const s = scheduler();
  const seen: number[] = [];
  const drag = coalesceDrag((p) => seen.push(p), s.schedule, s.cancel);

  drag.move(10);
  drag.move(20);
  s.frame();
  drag.move(30);
  drag.move(40);
  s.frame();

  assert.deepEqual(seen, [20, 40]);
});

test('a frame with no new position does not emit', () => {
  const s = scheduler();
  const seen: number[] = [];
  const drag = coalesceDrag((p) => seen.push(p), s.schedule, s.cancel);

  drag.move(5);
  s.frame();
  s.frame();
  s.frame();

  assert.deepEqual(seen, [5], 'idle frames are silent');
});

test('stop flushes a position still waiting for its frame', () => {
  // Otherwise releasing the pointer mid-frame settles the pane one frame
  // behind the cursor, which reads as the splitter snapping backwards.
  const s = scheduler();
  const seen: number[] = [];
  const drag = coalesceDrag((p) => seen.push(p), s.schedule, s.cancel);

  drag.move(200);
  s.frame();
  drag.move(240);
  drag.stop();

  assert.deepEqual(seen, [200, 240]);
});

test('stop cancels the pending frame rather than leaving it to fire', () => {
  const s = scheduler();
  const seen: number[] = [];
  const drag = coalesceDrag((p) => seen.push(p), s.schedule, s.cancel);

  drag.move(7);
  drag.stop();
  assert.equal(s.waiting, 0, 'no frame left queued');

  s.frame();
  assert.deepEqual(seen, [7], 'and the flush did not double-emit');
});

test('stop with nothing pending emits nothing', () => {
  const s = scheduler();
  const seen: number[] = [];
  const drag = coalesceDrag((p) => seen.push(p), s.schedule, s.cancel);

  drag.stop();
  drag.move(1);
  s.frame();
  drag.stop();

  assert.deepEqual(seen, [1]);
});

test('a burst of pointer events costs one render per frame, not one per event', () => {
  // The whole point, stated as a number: a one-second drag at 1000Hz used to be
  // 1000 renders. At 60fps it is now 60.
  const s = scheduler();
  let emits = 0;
  const drag = coalesceDrag(() => emits++, s.schedule, s.cancel);

  for (let frame = 0; frame < 60; frame++) {
    for (let event = 0; event < 17; event++) drag.move(frame * 17 + event);
    s.frame();
  }

  assert.equal(emits, 60);
});
