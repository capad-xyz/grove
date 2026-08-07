/**
 * Windowing maths for the commit list.
 *
 * The list renders one row and one SVG gutter per commit, which is fine at two
 * hundred and not at five thousand. Only the rows on screen need to exist.
 *
 * Every row is exactly `--row` tall, which is what makes this arithmetic rather
 * than measurement: the "since you last looked" boundary is given the same
 * height as a commit so the list stays a uniform grid. Variable heights would
 * mean measuring every item to know where any of them sits.
 */

export interface Range {
  /** First index to render, inclusive. */
  start: number;
  /** One past the last index to render. */
  end: number;
}

/**
 * Which items to render for a given scroll position.
 *
 * `overscan` renders a few rows beyond each edge so a fast scroll reaches
 * already-mounted rows instead of blank space.
 */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  total: number,
  overscan = 6,
): Range {
  if (total <= 0 || rowHeight <= 0) return { start: 0, end: 0 };

  const first = Math.floor(Math.max(0, scrollTop) / rowHeight);
  // `ceil` plus one: a viewport that is not an exact multiple of the row height
  // always straddles one more row than it can fully show.
  const count = Math.ceil(Math.max(0, viewportHeight) / rowHeight) + 1;

  return {
    start: Math.max(0, first - overscan),
    end: Math.min(total, first + count + overscan),
  };
}

/**
 * Scroll offset that brings `index` into view, or null if it already is.
 *
 * Returns the *nearest* position rather than centring: recentring on every
 * keypress makes a list feel like it is fighting you, which is the same reason
 * the DOM version uses `block: 'nearest'`. Virtualised rows may not exist yet,
 * so this cannot lean on `scrollIntoView`.
 */
export function scrollToShow(
  index: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
): number | null {
  const top = index * rowHeight;
  const bottom = top + rowHeight;

  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportHeight) return bottom - viewportHeight;
  return null;
}

/** Total scrollable height, so the scrollbar reflects the whole list. */
export const totalHeight = (total: number, rowHeight: number): number =>
  Math.max(0, total) * rowHeight;
