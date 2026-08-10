/**
 * Progressive mounting for the diff pane.
 *
 * `content-visibility` in app.css takes care of *layout and paint* for rows that
 * are off screen, which is what made a 30,000-row patch cheap to lay out. It
 * cannot help with the other half: React still builds and reconciles 30,000
 * elements in one synchronous pass before the browser is handed anything at all,
 * and that pass is the remaining freeze on opening a large commit.
 *
 * So the rows arrive in batches, one per frame. The first batch is sized to fill
 * any pane on any display, so the diff is readable immediately; the rest land
 * over the following frames, and because rows only ever append below, nothing
 * the reader is looking at moves while they do.
 *
 * This is deliberately *not* the windowing in `window.ts`. That maps a scroll
 * position to a range and needs a known row height, which wrapped diff lines do
 * not have (see `24fb560`). Growing a prefix needs no heights, no scroll
 * handler, and no measurement — and once every row exists, the pane behaves
 * exactly as it did before, including native find and text selection across the
 * whole document.
 */

/**
 * Rows mounted on the first frame.
 *
 * Comfortably more than any pane can show — at the code line-height a 4K display
 * turned portrait is still under 250 rows — so the reader never sees the
 * staircase, only a diff that opened.
 */
export const FIRST_CHUNK = 1000;

/**
 * Rows added per frame after the first.
 *
 * The trade is per-frame cost against how long the staircase runs. At roughly
 * 23µs of React per row this is a ~45ms frame: above a 60Hz budget, so the
 * animation is not perfectly smooth, but far below the threshold where input
 * stops being answered — which is the thing that made the old behaviour read as
 * a freeze rather than as loading.
 */
export const NEXT_CHUNK = 2000;

/** Rows to mount before the first paint of a patch with `total` lines. */
export function firstCount(total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(total, FIRST_CHUNK);
}

/**
 * Rows that should exist after one more frame.
 *
 * Clamped to `total` so the staircase terminates, and never returns less than it
 * was given — a shrinking prefix would unmount rows the reader is looking at.
 */
export function nextCount(mounted: number, total: number, step: number = NEXT_CHUNK): number {
  if (!(total > 0)) return 0;
  const at = Math.max(0, mounted);
  if (at >= total) return total;
  return Math.min(total, at + Math.max(1, step));
}

/** True once every row exists and the per-frame growth can stop. */
export const isComplete = (mounted: number, total: number): boolean =>
  Math.max(0, mounted) >= Math.max(0, total);

/** Schedules a callback for the next frame, returning a handle to cancel it. */
export type Schedule = (run: () => void) => number;
export type Cancel = (handle: number) => void;

/**
 * Grow the mounted prefix to `total`, one batch per frame, calling `emit` with
 * each new count. Returns a function that stops the staircase where it stands.
 *
 * The scheduler is injected for the same reason `drag.ts` injects one: a frame
 * clock is not something the test suite has, and `requestAnimationFrame` does
 * not fire at all in a window that is not compositing — minimised, occluded, or
 * running under a headless harness. Passing it in means the interesting
 * behaviour (that the staircase always terminates, never goes backwards, and
 * cancels cleanly mid-flight) can be cranked by hand with no DOM.
 *
 * That rAF stops in a hidden window is the right behaviour to keep, not a bug to
 * route around: there is no reason to spend frames building rows nobody is
 * looking at, and the next real frame resumes exactly where this left off.
 */
export function runStaircase(
  total: number,
  emit: (mounted: number) => void,
  schedule: Schedule,
  cancel: Cancel = () => {},
): () => void {
  let mounted = firstCount(total);
  let handle: number | null = null;

  emit(mounted);

  const step = (): void => {
    handle = null;
    if (isComplete(mounted, total)) return;
    mounted = nextCount(mounted, total);
    emit(mounted);
    if (!isComplete(mounted, total)) handle = schedule(step);
  };

  if (!isComplete(mounted, total)) handle = schedule(step);

  return () => {
    if (handle !== null) {
      cancel(handle);
      handle = null;
    }
  };
}
