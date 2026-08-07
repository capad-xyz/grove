/**
 * The lane gutter drawn beside each commit row.
 *
 * One small SVG per row rather than a single tall canvas: rows can then be
 * reordered, filtered, or eventually virtualised without recomputing a whole
 * drawing, and each row's graphic travels with its row.
 *
 * Greyscale like everything else. The graph is structure, not content — if it
 * were coloured it would compete with the diff, which is the one thing allowed
 * to be loud (DESIGN-SYSTEM.md §2).
 */

import type { GraphRow } from '../data/graph';

const LANE = 11; // px between lane centres
const R = 2.6; // node radius

const laneX = (lane: number) => lane * LANE + LANE / 2;

/**
 * A connector between two lanes across half a row. Straight when the lanes
 * match, otherwise a cubic easing sideways — a diagonal reads as a cut corner
 * at this size, where a curve reads as a branch.
 */
function connector(fromLane: number, fromY: number, toLane: number, toY: number): string {
  const x1 = laneX(fromLane);
  const x2 = laneX(toLane);
  if (x1 === x2) return `M${x1},${fromY} L${x2},${toY}`;
  const mid = (fromY + toY) / 2;
  return `M${x1},${fromY} C${x1},${mid} ${x2},${mid} ${x2},${toY}`;
}

export function GraphGutter({
  row,
  width,
  height,
  isNew,
}: {
  row: GraphRow;
  width: number;
  height: number;
  isNew: boolean;
}) {
  const w = width * LANE;
  const mid = height / 2;
  const x = laneX(row.lane);

  return (
    <svg
      className="graph"
      width={w}
      height={height}
      viewBox={`0 0 ${w} ${height}`}
      aria-hidden="true"
      focusable="false"
    >
      {/* Lanes crossing this row untouched. */}
      {row.passThrough.map((l) => (
        <line key={`p${l}`} x1={laneX(l)} y1={0} x2={laneX(l)} y2={height} className="g-line" />
      ))}

      {/* Everything feeding into this node from above. A tip has none. */}
      {row.incoming.map((l) => (
        <path key={`i${l}`} d={connector(l, 0, row.lane, mid)} className="g-line" fill="none" />
      ))}

      {/* Everything leaving downward — first parent straight, merges curving. */}
      {row.outgoing.map((l) => (
        <path key={`o${l}`} d={connector(row.lane, mid, l, height)} className="g-line" fill="none" />
      ))}

      <circle cx={x} cy={mid} r={R} className={isNew ? 'g-node g-node-new' : 'g-node'} />
    </svg>
  );
}

export { LANE as LANE_WIDTH };
