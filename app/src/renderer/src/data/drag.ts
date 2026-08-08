/**
 * Coalescing for a pointer drag.
 *
 * A pointer reports far faster than the screen redraws — 120Hz trackpads are
 * ordinary and gaming mice go past 1000Hz — so a handler that calls setState
 * once per `pointermove` asks React to render several times per frame, and
 * every one of those renders is thrown away except the last.
 *
 * That is survivable when the tree is small. It is not survivable when the
 * diff pane is showing tens of thousands of rows: each discarded render still
 * costs its full reconciliation, the events queue faster than they drain, and
 * the backlog outlives the drag. The renderer stops answering, which is felt as
 * the whole machine hesitating rather than as one slow pane.
 *
 * So the drag collects positions and emits at most one per frame. The scheduler
 * is injected rather than reaching for `requestAnimationFrame` directly, which
 * is what lets the coalescing be tested without a DOM.
 */

export interface Drag {
  /** Record a pointer position. Emits on the next frame, not now. */
  move(position: number): void;
  /** Emit any position still waiting for its frame, and stop. */
  stop(): void;
}

export function coalesceDrag(
  emit: (position: number) => void,
  schedule: (fn: () => void) => number = requestAnimationFrame,
  cancel: (handle: number) => void = cancelAnimationFrame,
): Drag {
  let pending: number | null = null;
  let frame: number | null = null;

  const flush = () => {
    frame = null;
    if (pending === null) return;
    const position = pending;
    pending = null;
    emit(position);
  };

  return {
    move(position) {
      pending = position;
      // Already waiting on a frame: that frame will read the newer position.
      if (frame === null) frame = schedule(flush);
    },
    stop() {
      if (frame !== null) {
        cancel(frame);
        frame = null;
      }
      // Flush synchronously so the pane settles where the pointer was released
      // rather than a frame behind it.
      if (pending !== null) {
        const position = pending;
        pending = null;
        emit(position);
      }
    },
  };
}
