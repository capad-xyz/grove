/**
 * The review surface.
 *
 * Layout adapts on container width (DESIGN-SYSTEM.md §8): one column with the
 * diff as an overlay when docked narrow, two panes when open wide. Both are
 * rendered; CSS decides which is visible, so there is no resize flicker and no
 * JS measuring the window.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CommitNode, RepoSummary, WorkingStatus, Worktree } from '@grove/engine';

import { Commits } from './components/Commits';
import { Diff } from './components/Diff';
import { RepoBar, Status, Worktrees } from './components/Chrome';
import { lastSeen, markSeen, source } from './data/source';

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

/** Where to open on launch. Electron passes a real repo; fixtures ignore it. */
const INITIAL_REPO = 'C:/Users/Aadarsh Upadhyay/Desktop/Grove';

export default function App() {
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * How many leading commits arrived since the user last looked. Captured once
   * per repo load and held steady — if it recomputed as commits streamed in,
   * the boundary would creep down the list while the user was reading it.
   */
  const [newCount, setNewCount] = useState(0);
  const seenRef = useRef<string | null>(null);

  const path = repo?.workdir ?? INITIAL_REPO;

  // --- Initial load -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [summary, log, st, wt] = await Promise.all([
          source.open(INITIAL_REPO),
          source.commits(INITIAL_REPO, 200),
          source.status(INITIAL_REPO),
          source.worktrees(INITIAL_REPO),
        ]);
        if (cancelled) return;

        // Fixtures mode is a design harness, so the marker is always seeded a
        // few commits down and never persisted — otherwise the first load
        // marks everything seen and the boundary can never be reviewed again.
        // Live mode reads the real marker and never fabricates one; an invented
        // marker would lie about what the user has actually seen.
        seenRef.current = source.live ? lastSeen(INITIAL_REPO) : (log[3]?.id ?? null);

        const idx = log.findIndex((c) => c.id === seenRef.current);
        // No marker yet (first ever open) means nothing is "new" — flagging the
        // entire history as unseen would be technically true and useless.
        setNewCount(seenRef.current === null ? 0 : idx === -1 ? log.length : idx);

        setRepo(summary);
        setCommits(log);
        setStatus(st);
        setWorktrees(wt);

        if (source.live) {
          if (log[0]) markSeen(INITIAL_REPO, log[0].id);
          void source.watch(INITIAL_REPO);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // --- Live refresh from the coordinator ----------------------------------
  useEffect(
    () =>
      source.onEvent((event) => {
        switch (event.kind) {
          case 'graph_changed':
            setCommits(event.commits);
            break;
          case 'status_changed':
            setStatus(event.status);
            break;
          case 'worktrees_changed':
            setWorktrees(event.worktrees);
            break;
          case 'refresh_error':
            setError(`${event.op}: ${event.message}`);
            break;
        }
      }),
    [],
  );

  // --- Diff for the selected commit ---------------------------------------
  const selectCommit = useCallback(
    (oid: string) => {
      setSelected(oid);
      setPatch(null);
      source
        .commitDiff(path, oid)
        .then(setPatch)
        .catch((e) => setPatch(`Could not load diff.\n\n${String(e)}`));
    },
    [path],
  );

  const title = useMemo(() => {
    const c = commits.find((x) => x.id === selected);
    return c ? `${c.short}  ${c.summary}` : 'diff';
  }, [commits, selected]);

  const dirty = Boolean(
    status && (status.staged.length || status.unstaged.length || status.untracked.length),
  );

  const diffPane = (
    <Diff patch={selected ? patch : null} title={selected ? title : 'diff'} />
  );

  return (
    <div className="app">
      <RepoBar repo={repo} dirty={dirty} live={source.live} />
      <Worktrees worktrees={worktrees} />

      {error && (
        <div className="empty" role="alert">
          {error}
        </div>
      )}

      <div className="body">
        <div className="pane-commits">
          <div className="section-head">
            <span className="label">commits</span>
            <span className="rule" />
          </div>
          <div className="scroll">
            <Commits
              commits={commits}
              newCount={newCount}
              selected={selected}
              onSelect={selectCommit}
            />
          </div>
        </div>

        <div className="pane-diff">{diffPane}</div>
      </div>

      <Status status={status} />

      {/* Narrow posture: the diff takes the whole surface. Hidden by CSS at
          >= 700px, where the pane above is showing the same thing. */}
      {selected && (
        <div className="overlay">
          <Diff patch={patch} title={title} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  );
}
