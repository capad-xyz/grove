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

  // --- Writes. Each one pokes the coordinator on the main side, so the
  //     refresh arrives as a normal repo event rather than a second,
  //     racing fetch. ---
  stage(path: string, file: string): Promise<void>;
  unstage(path: string, file: string): Promise<void>;
  stageAll(path: string): Promise<void>;
  unstageAll(path: string): Promise<void>;
  commit(path: string, message: string): Promise<string>;
  draftMessage(path: string): Promise<string>;
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

  stage: (p, file) => window.grove.stageFile(p, file),
  unstage: (p, file) => window.grove.unstageFile(p, file),
  stageAll: (p) => window.grove.stageAll(p),
  unstageAll: (p) => window.grove.unstageAll(p),
  commit: (p, message) => window.grove.commitChanges(p, message),
  draftMessage: (p) => window.grove.generateCommitMessage(p),
});

/**
 * Fixture-backed source.
 *
 * Stateful on purpose. Writes mutate a working copy and then emit a
 * `status_changed` event, exactly as the real coordinator does after a write
 * pokes it — so staging can be exercised in a browser, and no component can
 * tell which source it is talking to. A fixture that silently ignored writes
 * would make the harness a liar about the one flow it most needs to prove.
 */
const fixtureSource = (): Source => {
  const wait = <T,>(v: T, ms = 120): Promise<T> =>
    new Promise((r) => setTimeout(() => r(v), ms));

  const state: WorkingStatus = structuredClone(FIXTURE_STATUS);
  let commits = [...FIXTURE_COMMITS];
  const listeners = new Set<(e: RepoEventEnvelope) => void>();
  let gen = 0;

  const emitStatus = () => {
    gen += 1;
    const dirty =
      state.staged.length + state.unstaged.length + state.untracked.length > 0;
    const snapshot = structuredClone(state);
    for (const l of listeners) l({ kind: 'status_changed', gen, root: '', status: snapshot, dirty });
  };

  const emitGraph = () => {
    gen += 1;
    for (const l of listeners) {
      l({ kind: 'graph_changed', gen, root: '', head: 'reauthor', commits, unpushed: [] });
    }
  };

  /** Move one path into `staged`, wherever it currently lives. */
  const stageOne = (file: string) => {
    const fromUnstaged = state.unstaged.find((f) => f.path === file);
    const wasUntracked = state.untracked.includes(file);
    if (!fromUnstaged && !wasUntracked) return;

    state.unstaged = state.unstaged.filter((f) => f.path !== file);
    state.untracked = state.untracked.filter((p) => p !== file);
    if (!state.staged.some((f) => f.path === file)) {
      state.staged.push({ path: file, status: wasUntracked ? 'A' : (fromUnstaged?.status ?? 'M') });
    }
  };

  const unstageOne = (file: string) => {
    const entry = state.staged.find((f) => f.path === file);
    if (!entry) return;
    state.staged = state.staged.filter((f) => f.path !== file);
    // An added file returns to untracked; anything else to unstaged.
    if (entry.status === 'A') state.untracked.push(file);
    else if (!state.unstaged.some((f) => f.path === file)) {
      state.unstaged.push({ path: file, status: entry.status });
    }
  };

  return {
    live: false,
    open: () => wait(FIXTURE_REPO),
    commits: (_p, limit) => wait(commits.slice(0, limit)),
    status: () => wait(structuredClone(state)),
    worktrees: () => wait(FIXTURE_WORKTREES),
    fileDiff: () => wait(FIXTURE_DIFF),
    commitDiff: () => wait(FIXTURE_DIFF),
    onEvent: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    watch: () => wait(undefined),
    unwatch: () => wait(undefined),

    recents: () => wait(FIXTURE_RECENTS),
    remember: () => wait(FIXTURE_RECENTS),
    listDir: () => wait(FIXTURE_DIR),
    clone: () => Promise.reject(new Error('Cloning needs the desktop app.')),

    stage: async (_p, file) => {
      await wait(undefined, 40);
      stageOne(file);
      emitStatus();
    },
    unstage: async (_p, file) => {
      await wait(undefined, 40);
      unstageOne(file);
      emitStatus();
    },
    stageAll: async () => {
      await wait(undefined, 40);
      [...state.unstaged.map((f) => f.path), ...state.untracked].forEach(stageOne);
      emitStatus();
    },
    unstageAll: async () => {
      await wait(undefined, 40);
      [...state.staged.map((f) => f.path)].forEach(unstageOne);
      emitStatus();
    },
    commit: async (_p, message) => {
      await wait(undefined, 60);
      if (state.staged.length === 0) throw new Error('Nothing staged.');
      commits = [
        {
          id: `fixture${gen}`.padEnd(40, '0'),
          short: `fix${gen}`.slice(0, 7),
          parents: [commits[0]?.id ?? ''],
          author: 'capad.fyi',
          time: Math.floor(Date.now() / 1000),
          refs: ['reauthor'],
          summary: message.split('\n')[0] ?? message,
        },
        ...commits,
      ];
      state.staged = [];
      emitStatus();
      emitGraph();
      return 'committed';
    },
    draftMessage: () =>
      Promise.reject(new Error('Drafting needs a local agent — try the desktop app.')),
  };
};

export const source: Source =
  typeof window !== 'undefined' && typeof window.grove?.openRepo === 'function'
    ? liveSource()
    : fixtureSource();

// The "since you last looked" mark and its arithmetic live in ./seen.ts, kept
// separate so they can be tested without a DOM.
