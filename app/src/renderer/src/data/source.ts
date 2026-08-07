/**
 * The seam between the interface and its data.
 *
 * In Electron this is the real bridge. In a plain browser (`npm run
 * dev:renderer`) `window.grove` does not exist, so it serves fixtures instead.
 * That is what lets the UI be designed and reviewed at a browser refresh rate
 * rather than an Electron relaunch — and it keeps every component honest, since
 * none of them may reach for `window.grove` directly.
 */

import type {
  CommitNode,
  DirListing,
  RecentRepo,
  RepoEventEnvelope,
  RepoSummary,
  WorkingStatus,
  Worktree,
} from '@grove/engine';

import {
  FIXTURE_COMMITS,
  FIXTURE_DIFF,
  FIXTURE_DIR,
  FIXTURE_RECENTS,
  FIXTURE_REPO,
  FIXTURE_STATUS,
  FIXTURE_WORKTREES,
} from './fixtures';

export interface Source {
  readonly live: boolean;
  open(path: string): Promise<RepoSummary>;
  commits(path: string, limit: number): Promise<CommitNode[]>;
  status(path: string): Promise<WorkingStatus>;
  worktrees(path: string): Promise<Worktree[]>;
  fileDiff(path: string, oid: string, file: string): Promise<string>;
  commitDiff(path: string, oid: string): Promise<string>;
  onEvent(listener: (e: RepoEventEnvelope) => void): () => void;
  watch(path: string): Promise<void>;
  unwatch(): Promise<void>;

  // --- Choosing a repository ---
  recents(): Promise<RecentRepo[]>;
  remember(path: string, name: string): Promise<RecentRepo[]>;
  listDir(path: string): Promise<DirListing>;
  clone(url: string): Promise<string>;
}

const liveSource = (): Source => ({
  live: true,
  open: (p) => window.grove.openRepo(p),
  commits: (p, limit) => window.grove.commitGraph(p, limit, null),
  status: (p) => window.grove.workingStatus(p),
  worktrees: (p) => window.grove.worktrees(p),
  fileDiff: (p, oid, file) => window.grove.fileDiff(p, oid, file),
  async commitDiff(p, oid) {
    // The engine exposes per-file diffs; the detail call gives us the file list
    // to concatenate. Cheap enough at review sizes, and it keeps the engine's
    // surface smaller than adding a whole-commit diff command.
    const detail = await window.grove.commitDetail(p, oid);
    const parts = await Promise.all(
      detail.files.map((f) => window.grove.fileDiff(p, oid, f.path).catch(() => '')),
    );
    return parts.filter(Boolean).join('\n');
  },
  onEvent: (l) => window.grove.onRepoEvent(l),
  watch: (p) => window.grove.watchRepo(p),
  unwatch: () => window.grove.unwatchRepo(),

  recents: () => window.grove.recentRepos(),
  remember: (p, name) => window.grove.addRecentRepo(p, name),
  listDir: (p) => window.grove.listDir(p),
  clone: (url) => window.grove.cloneRepo(url),
});

/** Fixture-backed source with a small delay, so loading states are real. */
const fixtureSource = (): Source => {
  const wait = <T,>(v: T, ms = 120): Promise<T> =>
    new Promise((r) => setTimeout(() => r(v), ms));

  return {
    live: false,
    open: () => wait(FIXTURE_REPO),
    commits: (_p, limit) => wait(FIXTURE_COMMITS.slice(0, limit)),
    status: () => wait(FIXTURE_STATUS),
    worktrees: () => wait(FIXTURE_WORKTREES),
    fileDiff: () => wait(FIXTURE_DIFF),
    commitDiff: () => wait(FIXTURE_DIFF),
    onEvent: () => () => {},
    watch: () => wait(undefined),
    unwatch: () => wait(undefined),

    recents: () => wait(FIXTURE_RECENTS),
    remember: () => wait(FIXTURE_RECENTS),
    listDir: () => wait(FIXTURE_DIR),
    clone: () => Promise.reject(new Error('Cloning needs the desktop app.')),
  };
};

export const source: Source =
  typeof window !== 'undefined' && typeof window.grove?.openRepo === 'function'
    ? liveSource()
    : fixtureSource();

// The "since you last looked" mark and its arithmetic live in ./seen.ts, kept
// separate so they can be tested without a DOM.
