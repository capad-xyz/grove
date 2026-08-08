/**
 * The engine's public surface.
 *
 * This is the whole contract an app shell needs: the Electron main process will
 * map these onto `ipcMain.handle` calls, one per function, the same way
 * `lib.rs` mapped them onto `#[tauri::command]`. Nothing in this package knows
 * what a window is.
 */

export * from './types.ts';

export { discover, workdirOf } from './discover.ts';
export { GitError, git, gitRead, isLockError } from './git.ts';
export { Recents, defaultConfigDir, normPath } from './recents.ts';
export { startRepoService, type EmitFn, type RepoService } from './service.ts';
export { classify, startWatcher, type Watcher } from './watch.ts';
export { manual, generateMessage, type Agent, type PrDraft } from './agent.ts';

export {
  open,
  graph,
  branches,
  commitDetail,
  commitDiff,
  fileBytesAt,
  fileDiff,
  fileDiffBetween,
  fileAt,
  fileHistory,
  listDir,
  listFiles,
  allFiles,
  grepRepo,
  searchCommits,
  blame,
  worktrees,
  unpushedCommits,
  workingStatus,
  workingDiff,
  workingFile,
  workingFileBytes,
  workingFilePreview,
  isDirty,
  stagedDiff,
} from './read.ts';

export type { WorkingPreview } from './read.ts';

export {
  stage,
  unstage,
  stageAll,
  unstageAll,
  commit,
  clone,
  cloneToGroveRepos,
  maybeWriteCommitGraph,
} from './write.ts';

import { INV_FULL, type RepoEventEnvelope } from './types.ts';
import { startRepoService, type RepoService } from './service.ts';
import { startWatcher, type Watcher } from './watch.ts';
import { maybeWriteCommitGraph } from './write.ts';

/**
 * A repository being watched: the service and its watcher, tied together.
 *
 * Ported from the `watch_repo` command plus `WatchState` in `lib.rs`. Closing
 * one stops the watcher and ends the coordinator, exactly as dropping the Rust
 * pair did.
 */
export interface WatchedRepo {
  /** Nudge the coordinator — write commands call this so a stage/commit
   *  refreshes through the same pipeline as watcher events, with no racing
   *  parallel fetches. */
  poke(bits: number): void;
  close(): Promise<void>;
}

/**
 * Start the repo service and the classified watcher for `root`, pushing state
 * updates to `emit`. An initial full invalidation primes every slice.
 */
export function watchRepo(root: string, emit: (e: RepoEventEnvelope) => void): WatchedRepo {
  const service: RepoService = startRepoService(root, emit);
  const watcher: Watcher = startWatcher(root, (bits) => service.poke(bits));

  maybeWriteCommitGraph(root);
  service.poke(INV_FULL); // prime: emit the opening state without waiting for a change

  return {
    poke: (bits) => service.poke(bits),
    close: async () => {
      await watcher.close();
      service.stop();
    },
  };
}
