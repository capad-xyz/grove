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
import { Home, nameOf } from './components/Home';
import { RepoBar, Status, Worktrees } from './components/Chrome';
import { source } from './data/source';
import {
  fileCount,
  isAway,
  lastSeen,
  markSeen,
  measureAway,
  type Away,
  type SeenMark,
} from './data/seen';

import './styles/tokens.css';
import './styles/base.css';
import './styles/app.css';

export default function App() {
  const [path, setPath] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [patch, setPatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * How many leading commits arrived since the user last looked. Recomputed
   * only when the window regains focus — if it tracked live it would creep down
   * the list while the user was reading it, which is the one thing §7 forbids.
   */
  const [newCount, setNewCount] = useState(0);
  const [away, setAway] = useState<Away | null>(null);

  // Refs so the blur handler reads current values without re-subscribing.
  const pathRef = useRef<string | null>(null);
  const commitsRef = useRef<CommitNode[]>([]);
  const statusRef = useRef<WorkingStatus | null>(null);
  pathRef.current = path;
  commitsRef.current = commits;
  statusRef.current = status;

  // --- Open a repository --------------------------------------------------
  const openRepo = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      setSelected(null);
      setPatch(null);
      setAway(null);

      try {
        const [summary, log, st, wt] = await Promise.all([
          source.open(target),
          source.commits(target, 200),
          source.status(target),
          source.worktrees(target),
        ]);

        // Fixtures mode seeds a mark so the boundary can be reviewed at all;
        // live mode reads the real one and never fabricates it, because an
        // invented mark would lie about what the user has actually seen.
        const mark: SeenMark | null = source.live
          ? lastSeen(target)
          : { sha: log[3]?.id ?? null, files: 0 };

        const delta = measureAway(mark, log, st);
        setNewCount(delta.commits);
        setAway(isAway(delta) ? delta : null);

        setPath(target);
        setRepo(summary);
        setCommits(log);
        setStatus(st);
        setWorktrees(wt);

        if (source.live) {
          void source.remember(target, nameOf(target));
          void source.watch(target);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPath(null);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // --- Live refresh from the coordinator ----------------------------------
  useEffect(
    () =>
      source.onEvent((event) => {
        if (pathRef.current === null) return;
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

  // --- "Since you last looked" is literally that: since this window last had
  //     focus. Written on blur, read on focus. -----------------------------
  useEffect(() => {
    const onBlur = () => {
      const p = pathRef.current;
      if (!p || !source.live) return;
      // Everything on screen when you looked away is, by definition, seen.
      markSeen(p, {
        sha: commitsRef.current[0]?.id ?? null,
        files: fileCount(statusRef.current),
      });
      setAway(null);
    };

    const onFocus = () => {
      const p = pathRef.current;
      if (!p || !source.live) return;
      const delta = measureAway(lastSeen(p), commitsRef.current, statusRef.current);
      setNewCount(delta.commits);
      setAway(isAway(delta) ? delta : null);
    };

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // --- Diff for the selected commit ---------------------------------------
  const selectCommit = useCallback(
    (oid: string) => {
      if (!path) return;
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

  if (path === null) {
    return (
      <div className="app">
        {error && (
          <div className="empty" role="alert">
            {error}
          </div>
        )}
        <Home onOpen={(p) => void openRepo(p)} />
      </div>
    );
  }

  const dirty = fileCount(status) > 0;

  return (
    <div className="app">
      <RepoBar
        repo={repo}
        dirty={dirty}
        live={source.live}
        busy={loading}
        onBack={() => {
          setPath(null);
          setRepo(null);
          setCommits([]);
          setStatus(null);
          setWorktrees([]);
          setSelected(null);
          void source.unwatch();
        }}
      />
      <Worktrees worktrees={worktrees} />

      {/* The one moment the accent earns its keep. Dismissed by acknowledging
          it, and cleared automatically the next time focus is lost. */}
      {away && (
        <button className="away" onClick={() => setAway(null)}>
          <span className="away-text">
            {away.commits > 0 &&
              `${away.commits} commit${away.commits === 1 ? '' : 's'}`}
            {away.commits > 0 && away.files > 0 && ' · '}
            {away.files > 0 && `${away.files} more file${away.files === 1 ? '' : 's'} changed`}
            {' while you were away'}
          </span>
          <span className="label">dismiss</span>
        </button>
      )}

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

        <div className="pane-diff">
          <Diff patch={selected ? patch : null} title={selected ? title : 'diff'} />
        </div>
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
