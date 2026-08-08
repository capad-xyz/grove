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
  GrepHit,
  RecentRepo,
  RepoEventEnvelope,
  RepoSummary,
  WorkingStatus,
  Worktree,
  WorkingPreview,
} from '@grove/engine';

import {
  FIXTURE_BRANCHES,
  FIXTURE_COMMITS,
  FIXTURE_DIFF,
  FIXTURE_DIR,
  FIXTURE_FILES,
  FIXTURE_MARKDOWN,
  FIXTURE_WORKING_DIFF,
  FIXTURE_PNG,
  FIXTURE_GREP,
  FIXTURE_RECENTS,
  FIXTURE_REPO,
  FIXTURE_STATUS,
  FIXTURE_WORKTREES,
} from './fixtures';

export interface Source {
  readonly live: boolean;
  open(path: string): Promise<RepoSummary>;
  /** `refspec` narrows to one branch's history; null walks every ref. */
  commits(path: string, limit: number, refspec?: string | null): Promise<CommitNode[]>;
  status(path: string): Promise<WorkingStatus>;
  worktrees(path: string): Promise<Worktree[]>;
  fileDiff(path: string, oid: string, file: string): Promise<string>;
  commitDiff(path: string, oid: string): Promise<string>;
  /** Base64 bytes at a revision, or null. Used for image previews. */
  fileBytesAt(path: string, rev: string, file: string): Promise<string | null>;
  /** Text of a file at a revision. Used for the markdown preview. */
  fileAt(path: string, rev: string, file: string): Promise<string>;
  /** Diff of one working-tree file. `staged` selects the index side. */
  workingDiff(path: string, file: string, staged: boolean): Promise<string>;
  /** Text of a working-tree file, for previewing something git has no diff for. */
  workingFile(path: string, file: string): Promise<string>;
  /** Base64 bytes of a working-tree file, or null if unreadable or too large. */
  workingFileBytes(path: string, file: string): Promise<string | null>;
  workingFilePreview(path: string, file: string): Promise<WorkingPreview>;
  onEvent(listener: (e: RepoEventEnvelope) => void): () => void;
  watch(path: string): Promise<void>;
  unwatch(): Promise<void>;

  // --- Search. Files come back once per repo and are matched in the renderer;
  //     commits and content go to git on every (debounced) query. ---
  branches(path: string): Promise<string[]>;
  files(path: string): Promise<string[]>;
  searchCommits(path: string, query: string): Promise<CommitNode[]>;
  grep(path: string, query: string): Promise<GrepHit[]>;
  fileHistory(path: string, file: string): Promise<CommitNode[]>;

  // --- Choosing a repository ---
  /** Native folder chooser; null if cancelled or unavailable (browser). */
  pickDirectory(): Promise<string | null>;
  knownRoots(): Promise<{ label: string; path: string }[]>;
  /** Path for a dropped folder, or null if this source cannot resolve one. */
  pathForDropped(file: File): string | null;
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
  commits: (p, limit, refspec = null) => window.grove.commitGraph(p, limit, refspec),
  status: (p) => window.grove.workingStatus(p),
  worktrees: (p) => window.grove.worktrees(p),
  fileDiff: (p, oid, file) => window.grove.fileDiff(p, oid, file),
  // One git invocation. This used to fetch the commit's file list and then a
  // diff per file, which was two subprocesses per file — 43 of them for a
  // 21-file commit, landing concurrently on the main process and stalling
  // every other IPC reply behind them. That was the freeze on clicking a
  // commit: 913ms then, 106ms now.
  commitDiff: (p, oid) => window.grove.commitDiff(p, oid),
  fileBytesAt: (p, rev, file) => window.grove.fileBytesAt(p, rev, file),
  fileAt: (p, rev, file) => window.grove.fileAt(p, rev, file),
  workingDiff: (p, file, staged) => window.grove.workingDiff(p, file, staged),
  workingFile: (p, file) => window.grove.workingFile(p, file),
  workingFileBytes: (p, file) => window.grove.workingFileBytes(p, file),
  workingFilePreview: (p, file) => window.grove.workingFilePreview(p, file),
  onEvent: (l) => window.grove.onRepoEvent(l),
  watch: (p) => window.grove.watchRepo(p),
  unwatch: () => window.grove.unwatchRepo(),

  branches: (p) => window.grove.branches(p),
  // `allFiles` includes paths that only ever existed in history, so Spotlight
  // can find a file that was deleted three months ago — which is exactly when
  // you need to search for one.
  files: (p) => window.grove.allFiles(p),
  searchCommits: (p, q) => window.grove.searchCommits(p, q),
  grep: (p, q) => window.grove.grepRepo(p, q),
  fileHistory: (p, file) => window.grove.fileHistory(p, file),

  pickDirectory: () => window.grove.pickDirectory(),
  knownRoots: () => window.grove.knownRoots(),
  pathForDropped: (file) => window.grove.pathForDropped(file),
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
    // Honours `refspec` rather than ignoring it: a fixture that returned the
    // same list whichever branch you asked for would make the harness a liar
    // about filtering, which is the one thing it is being used to check.
    // Models "that branch's history" as the ref's commit and everything under
    // it, which is close enough to be a fair test of the UI.
    commits: (_p, limit, refspec = null) => {
      if (!refspec) return wait(commits.slice(0, limit));
      const at = commits.findIndex((c) => c.refs.includes(refspec));
      return wait((at === -1 ? commits : commits.slice(at)).slice(0, limit));
    },
    status: () => wait(structuredClone(state)),
    worktrees: () => wait(FIXTURE_WORKTREES),
    fileDiff: () => wait(FIXTURE_DIFF),
    // A 1x1 PNG: enough to prove the pipe renders without shipping an asset.
    fileAt: () => wait(FIXTURE_MARKDOWN),
    // An untracked file has no diff at all — that is the case the preview has
    // to handle, so the fixture models it.
    workingDiff: (_p, file) =>
      wait(file.startsWith("demo/") ? "" : FIXTURE_WORKING_DIFF.replace(/__FILE__/g, file)),
    workingFile: () => wait(FIXTURE_MARKDOWN),
    workingFileBytes: () => wait(FIXTURE_PNG),
    // Anything under demo/ that is not text stands in for a binary blob.
    workingFilePreview: (_p, file) =>
      wait(
        /.(mp4|png|tape)$/.test(file)
          ? { kind: "binary" as const, text: null, size: 48_213_402, truncated: false }
          : { kind: "text" as const, text: FIXTURE_MARKDOWN, size: FIXTURE_MARKDOWN.length, truncated: false },
      ),
    // Null on the parent side, and null at HEAD for anything untracked —
    // otherwise the harness shows a committed version of a file that has never
    // been committed, and the "new file" state becomes untestable.
    fileBytesAt: (_p, rev, file) =>
      wait(rev.endsWith('^') || file.startsWith('demo/') ? null : FIXTURE_PNG),
    commitDiff: () => wait(FIXTURE_DIFF),
    onEvent: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    watch: () => wait(undefined),
    unwatch: () => wait(undefined),

    branches: () => wait(FIXTURE_BRANCHES),
    files: () => wait(FIXTURE_FILES),
    // Mirrors the engine's ordering: hash, then message, then author.
    searchCommits: (_p, q) =>
      wait(
        FIXTURE_COMMITS.filter((c) => {
          const term = q.trim().toLowerCase();
          return (
            c.short.startsWith(term) ||
            c.summary.toLowerCase().includes(term) ||
            c.author.toLowerCase().includes(term)
          );
        }).slice(0, 8),
        220,
      ),
    grep: (_p, q) =>
      wait(
        FIXTURE_GREP.filter((h) => h.text.toLowerCase().includes(q.trim().toLowerCase())),
        260,
      ),
    fileHistory: (_p, file) =>
      wait(FIXTURE_COMMITS.filter((_, i) => (file.length + i) % 3 !== 0).slice(0, 5)),

    // A browser has no native chooser and cannot turn a dropped folder into a
    // path. Returning null rather than throwing lets the picker offer the same
    // affordances and simply report that this one needs the desktop app.
    pickDirectory: () => wait(null),
    knownRoots: () =>
      wait([
        { label: 'home', path: 'C:/Users/capad' },
        { label: 'desktop', path: 'C:/Users/capad/Desktop' },
      ]),
    pathForDropped: () => null,
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
