/**
 * The small surrounding pieces: repo bar, worktree strip, working status.
 *
 * The worktree strip is first-class rather than tucked in a menu because
 * DESIGN.md calls it out as increasingly central — one worktree per running
 * agent — and you cannot supervise parallel agents from a dropdown.
 */

import type { RepoSummary, Worktree } from '@grove/engine';

export function RepoBar({
  repo,
  dirty,
  live,
  busy,
  onBack,
}: {
  repo: RepoSummary | null;
  dirty: boolean;
  live: boolean;
  busy?: boolean;
  onBack?: () => void;
}) {
  const name = repo?.workdir?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'grove';

  return (
    <header className="repobar">
      {onBack && (
        <button className="back" onClick={onBack} title="Open another repository">
          ←
        </button>
      )}
      <span className="name">{name}</span>
      <span className="branch">{repo?.head ?? '(detached)'}</span>
      {dirty && <span className="dirty-dot" title="uncommitted changes" />}
      <span className="spacer" />
      {/* Refresh is ambient and constant, so this is a word rather than a
          spinner — a spinner every time an agent touches the repo would
          strobe (DESIGN-SYSTEM.md §9). */}
      {busy && <span className="label">loading</span>}
      {/* Browser mode is not a normal state; say so rather than quietly lying
          about which repository is on screen. */}
      {!live && <span className="mode">fixtures</span>}
    </header>
  );
}

export function Worktrees({ worktrees }: { worktrees: Worktree[] }) {
  if (worktrees.length === 0) return null;

  return (
    <nav className="worktrees" aria-label="Worktrees">
      {worktrees.map((w) => (
        <div className="wt" key={w.path} data-current={w.is_main}>
          <span>{w.branch ?? w.head}</span>
          {w.dirty && <span className="dirty-dot" title="uncommitted changes" />}
          {w.has_upstream && (w.ahead > 0 || w.behind > 0) && (
            <span className="ab">
              {w.ahead > 0 && `${w.ahead}↑`}
              {w.behind > 0 && `${w.behind}↓`}
            </span>
          )}
        </div>
      ))}
    </nav>
  );
}

// The working tree lives in WorkingTree.tsx — it is the only surface that
// writes, so it is worth keeping apart from this file's read-only chrome.
