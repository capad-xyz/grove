/**
 * Commit-graph lane assignment.
 *
 * One pass over the commits, which arrive newest-first in topological order
 * (the engine asks git for `--topo-order`, which is what makes a single pass
 * sufficient — a parent is never seen before its child).
 *
 * The model is a set of *lanes*, each holding the id of the commit it is
 * currently waiting for. Walking down the list:
 *
 *   - every lane waiting for this commit collapses into one (that is a merge
 *     arriving from several directions);
 *   - the commit's first parent continues in that same lane, so a branch's
 *     mainline stays in a straight column;
 *   - each additional parent takes a lane already waiting for it, or a new one.
 *
 * Kept pure and separate from rendering so the fiddly part is testable without
 * a DOM. Lane bookkeeping is exactly the kind of code that looks right and
 * silently leaks a column.
 */

import type { CommitNode } from '@grove/engine';

export interface GraphRow {
  /** Lane holding this commit's node. */
  lane: number;
  /** Lanes at the row's top edge that connect down into this node. */
  incoming: number[];
  /** Lanes at the row's bottom edge this node connects down to. */
  outgoing: number[];
  /** Lanes crossing the row untouched, drawn as straight verticals. */
  passThrough: number[];
  /** Lanes in use across the row, for sizing the gutter. */
  width: number;
}

/** Lowest free lane index, extending the set if all are occupied. */
function freeLane(lanes: (string | null)[]): number {
  const i = lanes.indexOf(null);
  if (i !== -1) return i;
  lanes.push(null);
  return lanes.length - 1;
}

export function layoutGraph(commits: readonly CommitNode[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const before = [...lanes];

    // Every lane waiting for this commit converges here. The first is the
    // node's lane; the rest are freed, and their lines are drawn as incoming.
    const claiming = lanes.reduce<number[]>((acc, id, i) => {
      if (id === commit.id) acc.push(i);
      return acc;
    }, []);

    let lane: number;
    if (claiming.length > 0) {
      lane = claiming[0]!;
      for (const extra of claiming.slice(1)) lanes[extra] = null;
    } else {
      // Nothing was waiting for it: a branch tip, so it starts a new lane.
      lane = freeLane(lanes);
    }

    const outgoing: number[] = [];
    if (commit.parents.length === 0) {
      lanes[lane] = null; // root commit: the lane ends here
    } else {
      // First parent continues straight down, keeping mainlines columnar.
      lanes[lane] = commit.parents[0]!;
      outgoing.push(lane);

      for (const parent of commit.parents.slice(1)) {
        // Reuse a lane already waiting for this parent so two branches merging
        // into one commit share a column instead of leaking a new one.
        let pl = lanes.indexOf(parent);
        if (pl === -1) {
          pl = freeLane(lanes);
          lanes[pl] = parent;
        }
        if (!outgoing.includes(pl)) outgoing.push(pl);
      }
    }

    // Untouched lanes: occupied before and after, holding the same commit, and
    // not this node's own lane.
    const passThrough: number[] = [];
    for (let i = 0; i < before.length; i++) {
      if (i !== lane && before[i] != null && before[i] === lanes[i]) passThrough.push(i);
    }

    rows.push({
      lane,
      incoming: claiming,
      outgoing,
      passThrough,
      width: Math.max(lanes.filter((l) => l !== null).length, lane + 1, before.length),
    });
  }

  // Trailing nulls can leave `lanes` longer than anything actually drawn, so
  // width is reported per row from what that row used.
  return rows;
}

/** Widest lane count across the layout, for sizing the gutter once. */
export function graphWidth(rows: readonly GraphRow[]): number {
  return rows.reduce(
    (m, r) => Math.max(m, r.lane + 1, ...r.outgoing.map((l) => l + 1), ...r.passThrough.map((l) => l + 1)),
    1,
  );
}
