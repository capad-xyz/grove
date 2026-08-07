/**
 * The IPC contract, shared by all three processes.
 *
 * `GroveApi` is exactly what the renderer sees on `window.grove`, and it is the
 * Electron equivalent of the 33 `#[tauri::command]` functions in `lib.rs`.
 * Channel names live in one object so main and preload cannot drift apart —
 * a typo is a compile error rather than a call that silently never resolves.
 */

import type {
  BlameLine,
  CommitDetail,
  CommitNode,
  DirListing,
  GrepHit,
  RecentRepo,
  RepoEventEnvelope,
  RepoSummary,
  WorkingStatus,
  Worktree,
} from '@grove/engine';

export const CHANNELS = {
  // Reads
  openRepo: 'grove:open-repo',
  commitGraph: 'grove:commit-graph',
  branches: 'grove:branches',
  commitDetail: 'grove:commit-detail',
  commitDiff: 'grove:commit-diff',
  fileDiff: 'grove:file-diff',
  fileBytesAt: 'grove:file-bytes-at',
  fileDiffBetween: 'grove:file-diff-between',
  fileAt: 'grove:file-at',
  fileHistory: 'grove:file-history',
  listDir: 'grove:list-dir',
  listFiles: 'grove:list-files',
  allFiles: 'grove:all-files',
  grepRepo: 'grove:grep-repo',
  searchCommits: 'grove:search-commits',
  blame: 'grove:blame',
  worktrees: 'grove:worktrees',
  unpushedCommits: 'grove:unpushed-commits',
  workingStatus: 'grove:working-status',
  workingDiff: 'grove:working-diff',
  workingFile: 'grove:working-file',
  workingFileBytes: 'grove:working-file-bytes',
  stagedDiff: 'grove:staged-diff',
  repoDirty: 'grove:repo-dirty',
  reposDirty: 'grove:repos-dirty',

  // Writes
  stageFile: 'grove:stage-file',
  unstageFile: 'grove:unstage-file',
  stageAll: 'grove:stage-all',
  unstageAll: 'grove:unstage-all',
  commitChanges: 'grove:commit-changes',
  cloneRepo: 'grove:clone-repo',

  // Agent
  generateCommitMessage: 'grove:generate-commit-message',

  // Choosing a repository
  pickDirectory: 'grove:pick-directory',
  knownRoots: 'grove:known-roots',

  // Session / lifecycle
  recentRepos: 'grove:recent-repos',
  addRecentRepo: 'grove:add-recent-repo',
  watchRepo: 'grove:watch-repo',
  unwatchRepo: 'grove:unwatch-repo',
  refreshRepo: 'grove:refresh-repo',
} as const;

/** Push channel for coordinator events — the `repo-event` Tauri emitted. */
export const REPO_EVENT_CHANNEL = 'grove:repo-event';

export type ChannelName = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * The renderer-facing API. Every method is async because every one crosses a
 * process boundary; the Rust commands were async for the same reason.
 */
export interface GroveApi {
  // --- Reads ---
  openRepo(path: string): Promise<RepoSummary>;
  commitGraph(path: string, limit: number, refspec: string | null): Promise<CommitNode[]>;
  branches(path: string): Promise<string[]>;
  commitDetail(path: string, oid: string): Promise<CommitDetail>;
  /** Whole-commit diff in one git invocation — see engine `commitDiff`. */
  commitDiff(path: string, oid: string): Promise<string>;
  fileDiff(path: string, oid: string, file: string): Promise<string>;
  /** Base64 bytes of a file at a revision, or null if absent there. */
  fileBytesAt(path: string, rev: string, file: string): Promise<string | null>;
  fileDiffBetween(path: string, a: string, b: string, file: string): Promise<string>;
  fileAt(path: string, rev: string, file: string): Promise<string>;
  fileHistory(path: string, file: string): Promise<CommitNode[]>;
  listDir(path: string): Promise<DirListing>;
  listFiles(path: string): Promise<string[]>;
  allFiles(path: string): Promise<string[]>;
  grepRepo(path: string, query: string): Promise<GrepHit[]>;
  searchCommits(path: string, query: string): Promise<CommitNode[]>;
  blame(path: string, file: string): Promise<BlameLine[]>;
  worktrees(path: string): Promise<Worktree[]>;
  unpushedCommits(path: string): Promise<string[]>;
  workingStatus(path: string): Promise<WorkingStatus>;
  workingDiff(path: string, file: string, staged: boolean): Promise<string>;
  workingFile(path: string, file: string): Promise<string>;
  /** Base64 bytes of a working-tree file, or null if unreadable or too large. */
  workingFileBytes(path: string, file: string): Promise<string | null>;
  stagedDiff(path: string): Promise<string>;
  repoDirty(path: string): Promise<boolean>;
  reposDirty(paths: string[]): Promise<Record<string, boolean>>;

  // --- Writes. Each pokes the coordinator, so state refreshes through the
  //     same pipeline as watcher events rather than racing it. ---
  stageFile(path: string, file: string): Promise<void>;
  unstageFile(path: string, file: string): Promise<void>;
  stageAll(path: string): Promise<void>;
  unstageAll(path: string): Promise<void>;
  commitChanges(path: string, message: string): Promise<string>;
  cloneRepo(url: string): Promise<string>;

  // --- Agent ---
  generateCommitMessage(path: string): Promise<string>;

  /** Native folder chooser. Resolves to null if the user cancels. */
  pickDirectory(): Promise<string | null>;
  /** Places worth a one-click shortcut in the picker. */
  knownRoots(): Promise<{ label: string; path: string }[]>;
  /**
   * Filesystem path for a dropped folder, or null. Synchronous because it is
   * pure preload — no IPC — and drop handlers cannot await before reading the
   * DataTransfer, whose items are cleared when the event handler returns.
   */
  pathForDropped(file: File): string | null;

  // --- Session ---
  recentRepos(): Promise<RecentRepo[]>;
  addRecentRepo(path: string, name: string): Promise<RecentRepo[]>;
  watchRepo(path: string): Promise<void>;
  unwatchRepo(): Promise<void>;
  refreshRepo(): Promise<void>;

  /** Subscribe to coordinator events. Returns an unsubscribe function. */
  onRepoEvent(listener: (event: RepoEventEnvelope) => void): () => void;
}

declare global {
  interface Window {
    grove: GroveApi;
  }
}
