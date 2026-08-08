/**
 * Pane geometry: how far the two draggable block boundaries may travel, and how
 * the sizes survive a restart.
 *
 * Kept pure and out of React for the same reason as `seen.ts`: a splitter drag
 * is a pointer gesture the browser harness cannot exercise, so the arithmetic is
 * the part that has to be provable on its own.
 *
 * Two units, on purpose, and each reason comes straight from DESIGN-SYSTEM.md:
 *
 * - The commits pane is stored in **pixels**. §9 fixes it at ~360px because its
 *   content has an intrinsic width — a graph gutter, a short SHA, a subject, a
 *   relative time — which has nothing to do with how wide the window is. Scaling
 *   it with the window would make it wrong at both ends.
 * - The working-tree panel is stored as a **fraction of the app's height**. Its
 *   default is written as a percentage (34%) because §1 says the screen budget
 *   varies wildly: a panel pinned at 300px is a third of a docked strip and a
 *   tenth of a second monitor.
 *
 * `null` means "the user has never dragged this one", which is not the same as
 * a stored default — it lets tokens.css and app.css stay the only place the
 * design's own numbers are written down.
 */

/**
 * Narrowest the commit list may be dragged: the gutter, a short SHA and enough
 * subject to tell two commits apart. Below this it stops being scannable, which
 * is the only thing it is for.
 */
export const MIN_COMMITS = 200;

/**
 * Narrowest the diff may be squeezed. Diffs are the content (§1), so the pane
 * that shows them keeps the larger floor of the two.
 */
export const MIN_DIFF = 260;

/** Shortest the working tree may be dragged: its header plus one file row. */
export const MIN_STATUS = 56;

/** Shortest the commits/diff body may be squeezed by dragging the panel up. */
export const MIN_BODY = 140;

export interface PaneSizes {
  /** Commits-pane width in CSS px, or null while the design default stands. */
  commits: number | null;
  /** Working-tree height as a fraction of the app, or null for the default. */
  status: number | null;
}

/** Nothing dragged yet. Also the answer whenever storage is unreadable. */
export const NO_PANES: PaneSizes = { commits: null, status: null };

/**
 * Hold a dragged size inside the band where both blocks stay usable.
 *
 * The floor wins ties: in a container too small to satisfy both, the block being
 * dragged keeps its minimum and the other one gives. That is the safer failure,
 * because a pane dragged to zero is a pane the user has no handle left to
 * recover.
 */
export function clampSplit(px: number, total: number, min: number, minRest: number): number {
  if (!Number.isFinite(px)) return min;
  return Math.min(Math.max(px, min), Math.max(min, total - minRest));
}

/**
 * Commits-pane width for a drag to `px` inside a body `total` px wide.
 *
 * Null when there is nothing to measure against — an unmounted or zero-width
 * body means the clamp would be arithmetic on a guess, and leaving the size
 * untouched is better than storing one.
 */
export function commitsWidth(px: number, total: number): number | null {
  if (!(total > 0)) return null;
  return clampSplit(px, total, MIN_COMMITS, MIN_DIFF);
}

/**
 * Working-tree height for a drag to `px` inside an app `total` px tall, as a
 * fraction of that height. Null on the same terms as `commitsWidth`.
 */
export function statusHeight(px: number, total: number): number | null {
  if (!(total > 0)) return null;
  return clampSplit(px, total, MIN_STATUS, MIN_BODY) / total;
}

/**
 * A stored fraction as a CSS length. Three decimals is under a tenth of a pixel
 * on a 4K window, and keeps the value short enough to read in devtools.
 */
export const cssPercent = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;

/**
 * Absolute bounds a *stored* size must sit inside.
 *
 * These are not the layout clamps. The window that produced the value is gone by
 * the time it is read back, so all this can do is reject nonsense: a corrupted
 * key, a hand-edited value, a width dragged on a 4K monitor and reopened on a
 * laptop. The layout-aware clamp happens on the next drag, and app.css carries
 * the final guarantee that neither block can eat the other whatever is in
 * storage.
 */
const STORED_COMMITS_MAX = 1600;
const STORED_STATUS_MIN = 0.05;
const STORED_STATUS_MAX = 0.85;

const bounded = (value: unknown, min: number, max: number): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, min), max)
    : null;

/** Whatever came out of storage, reduced to something safe to render. */
export function sanePanes(raw: unknown): PaneSizes {
  if (raw === null || typeof raw !== 'object') return NO_PANES;
  const v = raw as Record<string, unknown>;
  return {
    commits: bounded(v.commits, MIN_COMMITS, STORED_COMMITS_MAX),
    status: bounded(v.status, STORED_STATUS_MIN, STORED_STATUS_MAX),
  };
}

/**
 * Persisted in localStorage rather than component state, so a layout the user
 * arranged once is still there tomorrow. Same read/write shape as `seen.ts`:
 * every access is wrapped, because a browser with storage disabled should lose
 * a preference, not the window.
 */
const PANES_KEY = 'grove:panes';

export function readPanes(): PaneSizes {
  try {
    return sanePanes(JSON.parse(localStorage.getItem(PANES_KEY) ?? 'null'));
  } catch {
    return NO_PANES;
  }
}

export function writePanes(sizes: PaneSizes): void {
  try {
    localStorage.setItem(PANES_KEY, JSON.stringify(sizes));
  } catch {
    // Storage disabled or full: the panes simply stop surviving a restart.
  }
}
