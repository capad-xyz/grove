/**
 * The small surrounding pieces: repo bar, worktree strip, working status.
 *
 * The worktree strip is first-class rather than tucked in a menu because
 * DESIGN.md calls it out as increasingly central — one worktree per running
 * agent — and you cannot supervise parallel agents from a dropdown.
 */

import type { RepoSummary, WorkingStatus, Worktree } from '@grove/engine';

export function RepoBar({
  repo,
  dirty,
  live,
}: {
  repo: RepoSummary | null;
  dirty: boolean;
  live: boolean;
}) {
  const name = repo?.workdir?.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? 'grove';

  return (
    <header className="repobar">
      <span className="name">{name}</span>
      <span className="branch">{repo?.head ?? '(detached)'}</span>
      {dirty && <span className="dirty-dot" title="uncommitted changes" />}
      <span className="spacer" />
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

export function Status({ status }: { status: WorkingStatus | null }) {
  if (!status) return null;

  const files = [
    ...status.staged.map((f) => ({ ...f, group: 'staged' as const })),
    ...status.unstaged.map((f) => ({ ...f, group: 'unstaged' as const })),
    ...status.untracked.map((p) => ({ path: p, status: '?', group: 'untracked' as const })),
  ];

  return (
    <section className="status" aria-label="Working tree">
      <div className="section-head">
        <span className="label">working tree</span>
        <span className="rule" />
        <span className="label">{files.length === 0 ? 'clean' : `${files.length}`}</span>
      </div>

      {files.length === 0 ? (
        <div className="empty">Nothing to commit.</div>
      ) : (
        <div className="scroll">
          {files.map((f) => (
            <div className="row file" key={`${f.group}:${f.path}`}>
              <span className="code" data-code={f.status.trim()}>
                {f.status.trim() || '·'}
              </span>
              {/* RTL truncation keeps the filename visible and clips the
                  directory, which is the part you can afford to lose. */}
              <span className="path" title={f.path}>
                {f.path}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
