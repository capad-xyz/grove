/**
 * The commit list, and the boundary that is Grove's whole reason to exist:
 * everything above "since you last looked" arrived while you were away.
 *
 * Virtualised. Each row carries its own SVG gutter, so rendering all of them
 * meant thousands of DOM nodes on a real repository's history; only the rows on
 * screen are mounted. This component owns its scroll container because the
 * windowing needs `scrollTop`, and it keeps every item exactly one `--row` tall
 * — including the boundary — so position is arithmetic rather than measurement.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { CommitNode } from '@grove/engine';

import { graphWidth, layoutGraph } from '../data/graph';
import { scrollToShow, totalHeight, visibleRange } from '../data/window';
import { GraphGutter } from './GraphGutter';

/** Matches --row in tokens.css; the gutter has to draw to the row's edges. */
const ROW_H = 24;

/**
 * Beyond this the gutter would eat the pane in a docked strip, and a history
 * that wide is not readable as lanes anyway. Wider layouts still compute
 * correctly — only the drawing is clamped.
 */
const MAX_LANES = 7;

/** Compact relative time. Density matters more here than precision. */
export function ago(epochSeconds: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - epochSeconds);
  if (s < 90) return 'now';
  const m = s / 60;
  if (m < 60) return `${Math.round(m)}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  return `${Math.round(d / 30)}mo`;
}

type Item =
  | { kind: 'commit'; commit: CommitNode; row: number }
  | { kind: 'boundary'; count: number };

export function Commits({
  commits,
  newCount,
  selected,
  onSelect,
}: {
  commits: CommitNode[];
  /** How many leading commits arrived since the user last looked. */
  newCount: number;
  selected: string | null;
  onSelect: (oid: string) => void;
}) {
  const graph = useMemo(() => layoutGraph(commits), [commits]);
  const lanes = useMemo(() => Math.min(graphWidth(graph), MAX_LANES), [graph]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  /**
   * One flat array of fixed-height items. The boundary sits *below* the new
   * commits, so the eye lands on what is new first and the marker explains it,
   * rather than the other way round.
   */
  const items = useMemo(() => {
    const out: Item[] = [];
    commits.forEach((commit, row) => {
      if (row === newCount && newCount > 0) out.push({ kind: 'boundary', count: newCount });
      out.push({ kind: 'commit', commit, row });
    });
    return out;
  }, [commits, newCount]);

  // The viewport height decides how many rows to mount, and it changes when the
  // window resizes or the working-tree panel grows.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the selected row on screen. `scrollIntoView` is unavailable here: the
  // row may not be mounted, which is the whole point.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || selected === null) return;
    const index = items.findIndex((it) => it.kind === 'commit' && it.commit.id === selected);
    if (index === -1) return;
    const next = scrollToShow(index, el.scrollTop, el.clientHeight, ROW_H);
    if (next !== null) el.scrollTop = next;
  }, [selected, items]);

  if (commits.length === 0) {
    return <div className="empty">No commits yet.</div>;
  }

  const range = visibleRange(scrollTop, viewport, ROW_H, items.length);

  return (
    <div
      className="scroll commit-scroll"
      ref={scrollRef}
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      {/* Full-height spacer so the scrollbar reflects the whole history, not
          just the mounted slice. */}
      <div className="commit-spacer" style={{ height: totalHeight(items.length, ROW_H) }}>
        {items.slice(range.start, range.end).map((item, i) => {
          const index = range.start + i;
          const style = { top: index * ROW_H };

          if (item.kind === 'boundary') {
            return (
              <div className="since commit-slot" key="since-boundary" style={style}>
                <span>{item.count} since you last looked</span>
                <span className="rule" />
              </div>
            );
          }

          const { commit: c, row } = item;
          return (
            <div
              key={c.id}
              className="row commit commit-slot"
              style={style}
              role="button"
              tabIndex={0}
              data-new={row < newCount}
              data-selected={selected === c.id}
              onClick={() => onSelect(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelect(c.id);
                }
              }}
            >
              {graph[row] && (
                <GraphGutter
                  row={graph[row]!}
                  width={lanes}
                  height={ROW_H}
                  isNew={row < newCount}
                />
              )}
              <span className="sha">{c.short}</span>
              <span className="msg" title={c.summary}>
                {c.summary}
              </span>
              {c.refs.slice(0, 1).map((r) => (
                <span className="ref" key={r}>
                  {r}
                </span>
              ))}
              <span className="when">{ago(c.time)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
