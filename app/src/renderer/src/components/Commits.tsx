/**
 * The commit list, and the boundary that is Grove's whole reason to exist:
 * everything above "since you last looked" arrived while you were away.
 */

import type { CommitNode } from '@grove/engine';

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
  if (commits.length === 0) {
    return <div className="empty">No commits yet.</div>;
  }

  const rows: React.ReactNode[] = [];

  commits.forEach((c, i) => {
    // The boundary sits *below* the new commits, so the eye lands on what is
    // new first and the marker explains it, rather than the other way round.
    if (i === newCount && newCount > 0) {
      rows.push(
        <div className="since" key="since-boundary">
          <span>
            {newCount} since you last looked
          </span>
          <span className="rule" />
        </div>,
      );
    }

    rows.push(
      <div
        key={c.id}
        className="row commit"
        role="button"
        tabIndex={0}
        data-new={i < newCount}
        data-selected={selected === c.id}
        onClick={() => onSelect(c.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect(c.id);
          }
        }}
      >
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
      </div>,
    );
  });

  return <>{rows}</>;
}
