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
import { Spotlight, type Pick } from './components/Spotlight';
import { indexFiles, type FileEntry } from './data/match';
import { RepoBar, Worktrees } from './components/Chrome';
import { WorkingTree } from './components/WorkingTree';
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

/** A lens over the commit list: one branch's history, or one file's. */
type Filter = { kind: 'branch'; name: string } | { kind: 'file'; path: string } | null;

export default function App() {
  const [path, setPath] = useState<string | null>(null);
  const [repo, setRepo] = useState<RepoSummary | null>(null);
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  /** A working-tree file being previewed. Mutually exclusive with `selected`. */
  const [viewingFile, setViewingFile] = useState<{ path: string; staged: boolean } | null>(
    null,
  );
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

  // --- Search --------------------------------------------------------------
  const [spotlight, setSpotlight] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [fileIndex, setFileIndex] = useState<FileEntry[]>([]);
  /**
   * A branch or file narrowing the commit list. Held here rather than inside
   * Spotlight because it outlives the search: you pick a file, the palette
   * closes, and the list stays filtered until you clear it.
   */
  const [filter, setFilter] = useState<Filter>(null);
  /** Guards the one-time search-input fetch per repo. */
  const searchLoaded = useRef(false);

  // Refs so the blur handler reads current values without re-subscribing.
  const pathRef = useRef<string | null>(null);
  const commitsRef = useRef<CommitNode[]>([]);
  const statusRef = useRef<WorkingStatus | null>(null);
  const filterRef = useRef<Filter>(null);
  pathRef.current = path;
  commitsRef.current = commits;
  statusRef.current = status;
  filterRef.current = filter;

  // --- Open a repository --------------------------------------------------
  const openRepo = useCallback(
    async (target: string) => {
      setLoading(true);
      setError(null);
      setSelected(null);
      setPatch(null);
      setAway(null);
      setFilter(null);

      try {
        const [summary, log, st, wt] = await Promise.all([
          source.open(target),
          source.commits(target, 200),
          source.status(target),
          source.worktrees(target),
        ]);

        // Search inputs are NOT fetched here. `allFiles` walks the entire
        // history — measured at 250-500ms on small repos and unbounded on big
        // ones — and most repo opens never open Spotlight at all. Loading it
        // eagerly spent that on every open for nothing. It is fetched on first
        // use instead; see `openSpotlight`.
        searchLoaded.current = false;

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
            // A filter is a deliberate lens over history; replacing it with the
            // full graph because an agent committed would yank the user out of
            // what they were reading. The chip says the list is filtered, so a
            // list that does not move is the honest behaviour.
            if (filterRef.current === null) setCommits(event.commits);
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

  // --- Writes -------------------------------------------------------------
  // None of these refetch. Every write pokes the coordinator on the main side,
  // which recomputes and pushes a `status_changed` event — so the refresh
  // arrives through the same pipeline as a watcher event instead of racing it.
  const [writing, setWriting] = useState(false);

  const write = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    setWriting(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e; // callers decide what to keep on failure
    } finally {
      setWriting(false);
    }
  }, []);

  const toggleFile = useCallback(
    (file: string, staged: boolean) => {
      if (!path) return;
      void write(() => (staged ? source.unstage(path, file) : source.stage(path, file))).catch(
        () => {},
      );
    },
    [path, write],
  );

  /**
   * Open Spotlight, fetching its inputs the first time per repo. The palette
   * renders immediately and the file group fills in when the index lands —
   * which is the right trade, because commits and content are debounced behind
   * a keystroke anyway and nobody picks a file before typing.
   */
  const openSpotlight = useCallback(() => {
    setSpotlight(true);
    const target = pathRef.current;
    if (!target || searchLoaded.current) return;
    searchLoaded.current = true;

    void source
      .branches(target)
      .then(setBranches)
      .catch(() => setBranches([]));
    void source
      .files(target)
      .then((f) => setFileIndex(indexFiles(f)))
      .catch(() => setFileIndex([]));
  }, []);

  // --- Applying a Spotlight result -----------------------------------------
  // Everything resolves into the commit list or the diff; nothing opens a
  // surface that does not already exist.
  const applyFilter = useCallback(
    async (next: Filter) => {
      if (!path) return;
      setFilter(next);
      setSelected(null);
      setPatch(null);
      setNewCount(0); // the boundary counts the full graph, not a lens over it
      setLoading(true);
      try {
        const log =
          next === null
            ? await source.commits(path, 200)
            : next.kind === 'branch'
              ? await source.commits(path, 200, next.name)
              : await source.fileHistory(path, next.path);
        setCommits(log);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [path],
  );

  const onPick = useCallback(
    (pick: Pick) => {
      if (pick.kind === 'commit') {
        selectCommitRef.current(pick.oid);
        return;
      }
      void applyFilter(
        pick.kind === 'branch' ? { kind: 'branch', name: pick.name } : { kind: 'file', path: pick.path },
      );
    },
    [applyFilter],
  );

  // --- Keyboard ------------------------------------------------------------
  // Grove lives beside an editor, so it should be drivable without reaching for
  // the mouse. Selection-based rather than DOM-focus-based: that is how git
  // clients behave, and it keeps the diff in step with the highlighted row.
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  // Held in a ref so the key handler subscribes once instead of re-binding
  // every time the open repo changes.
  const selectCommitRef = useRef<(oid: string) => void>(() => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal keys from the commit message or the clone field.
      const t = e.target as HTMLElement | null;
      const typing =
        t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);

      // Ctrl/Cmd+K works even while typing — it is the universal "search"
      // gesture and there is nothing else it could mean.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openSpotlight();
        return;
      }

      if (typing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      // `/` is the vim-ish search gesture, and matches the placeholder's promise.
      if (e.key === '/') {
        e.preventDefault();
        openSpotlight();
        return;
      }

      const log = commitsRef.current;
      if (log.length === 0) return;
      const at = log.findIndex((c) => c.id === selectedRef.current);

      const go = (index: number) => {
        e.preventDefault();
        const next = log[Math.max(0, Math.min(log.length - 1, index))];
        if (next) selectCommitRef.current(next.id);
      };

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          return go(at === -1 ? 0 : at + 1);
        case 'k':
        case 'ArrowUp':
          return go(at === -1 ? 0 : at - 1);
        case 'Home':
          return go(0);
        case 'End':
          return go(log.length - 1);
        case 'Enter':
          if (at === -1) return go(0);
          return;
        case 'Escape':
          e.preventDefault();
          setSelected(null);
          setViewingFile(null);
          return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Keep the highlighted row on screen. `nearest` so it only scrolls when the
  // row is actually out of view — recentring on every keypress makes a list
  // feel like it is fighting you.
  useEffect(() => {
    if (!selected) return;
    document
      .querySelector('.commit[data-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  // --- Diff for the selected commit ---------------------------------------
  const selectCommit = useCallback(
    (oid: string) => {
      if (!path) return;
      setViewingFile(null); // the diff pane shows one thing at a time
      setSelected(oid);
      setPatch(null);
      source
        .commitDiff(path, oid)
        .then(setPatch)
        .catch((e) => setPatch(`Could not load diff.\n\n${String(e)}`));
    },
    [path],
  );

  /**
   * Preview a working-tree file. This is what a row click does now — looking at
   * a file must not be the same gesture as changing the index.
   */
  const viewFile = useCallback(
    (file: string, staged: boolean) => {
      if (!path) return;
      setSelected(null);
      setViewingFile({ path: file, staged });
      setPatch(null);
      source
        .workingDiff(path, file, staged)
        .then(setPatch)
        .catch((e) => setPatch(`Could not load diff.\n\n${String(e)}`));
    },
    [path],
  );
  selectCommitRef.current = selectCommit;

  const title = useMemo(() => {
    if (viewingFile) return `${viewingFile.path}  (${viewingFile.staged ? 'staged' : 'working'})`;
    const c = commits.find((x) => x.id === selected);
    return c ? `${c.short}  ${c.summary}` : 'diff';
  }, [commits, selected, viewingFile]);

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

      {/* A filter is a lens the user chose, so it stays visible and stays
          clearable. Without this the list would silently be a subset. */}
      {filter && (
        <button className="filter" onClick={() => void applyFilter(null)}>
          <span className="label">{filter.kind}</span>
          <span className="filter-text">
            {filter.kind === 'branch' ? filter.name : filter.path}
          </span>
          <span className="label">clear</span>
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
          <Diff
            patch={selected || viewingFile ? patch : null}
            title={selected || viewingFile ? title : 'diff'}
            repoPath={path}
            oid={selected}
          />
        </div>
      </div>

      <WorkingTree
        status={status}
        busy={writing}
        selected={viewingFile?.path ?? null}
        onView={viewFile}
        onToggle={toggleFile}
        onStageAll={() => void write(() => source.stageAll(path)).catch(() => {})}
        onUnstageAll={() => void write(() => source.unstageAll(path)).catch(() => {})}
        onCommit={async (message) => {
          await write(() => source.commit(path, message));
        }}
        onDraft={() => write(() => source.draftMessage(path))}
      />

      {spotlight && (
        <Spotlight
          repoPath={path}
          branches={branches}
          fileIndex={fileIndex}
          onPick={onPick}
          onClose={() => setSpotlight(false)}
        />
      )}

      {/* Narrow posture: the diff takes the whole surface. Hidden by CSS at
          >= 700px, where the pane above is showing the same thing. */}
      {(selected || viewingFile) && (
        <div className="overlay">
          <Diff
            patch={patch}
            title={title}
            onClose={() => {
              setSelected(null);
              setViewingFile(null);
            }}
            repoPath={path}
            oid={selected}
          />
        </div>
      )}
    </div>
  );
}
