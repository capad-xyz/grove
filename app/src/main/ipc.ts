/**
 * The IPC surface: one handler per engine call.
 *
 * This is the Electron equivalent of `lib.rs`'s `invoke_handler!` block. The
 * handlers are deliberately thin — all the logic lives in `@grove/engine`, and
 * nothing here should grow a second opinion about git.
 */

import { ipcMain, type BrowserWindow } from 'electron';

import * as engine from '@grove/engine';
import { INV_FULL, INV_INDEX, INV_WORKDIR, type RepoEventEnvelope } from '@grove/engine';

import { CHANNELS, REPO_EVENT_CHANNEL } from '../shared/ipc';

/**
 * The active watcher + service pair for the currently open repository.
 * Replacing it stops the previous watcher and ends its coordinator, exactly as
 * dropping the Rust `WatchState` pair did.
 */
let watched: { gen: number; root: string; repo: engine.WatchedRepo } | null = null;

/**
 * Bumped on every watch/unwatch. An event forwarder captures the generation it
 * was created with and drops anything once that generation is superseded, so
 * a stale watcher can never push events for a repo the user has left — and,
 * unlike comparing repo paths, this still holds if they reopen the same one.
 */
let watchGen = 0;

/** Nudge the live coordinator, if one is running. */
function poke(bits: number): void {
  watched?.repo.poke(bits);
}

async function stopWatching(): Promise<void> {
  watchGen += 1;
  const current = watched;
  watched = null;
  await current?.repo.close();
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Register a handler, normalising thrown errors to their message.
 * The Rust commands returned `Result<T, String>`; the renderer should see the
 * same plain text rather than a stringified stack.
 */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (...args: A) => R | Promise<R>,
): void {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...(args as A));
    } catch (e) {
      throw new Error(message(e));
    }
  });
}

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  const recents = new engine.Recents();

  // --- Reads ---
  handle(CHANNELS.openRepo, (path: string) => engine.open(path));
  handle(CHANNELS.commitGraph, (path: string, limit: number, refspec: string | null) =>
    engine.graph(path, limit, refspec),
  );
  handle(CHANNELS.branches, (path: string) => engine.branches(path));
  handle(CHANNELS.commitDetail, (path: string, oid: string) => engine.commitDetail(path, oid));
  handle(CHANNELS.fileDiff, (path: string, oid: string, file: string) =>
    engine.fileDiff(path, oid, file),
  );
  handle(CHANNELS.fileDiffBetween, (path: string, a: string, b: string, file: string) =>
    engine.fileDiffBetween(path, a, b, file),
  );
  handle(CHANNELS.fileAt, (path: string, rev: string, file: string) =>
    engine.fileAt(path, rev, file),
  );
  handle(CHANNELS.fileHistory, (path: string, file: string) => engine.fileHistory(path, file));
  handle(CHANNELS.listDir, (path: string) => engine.listDir(path));
  handle(CHANNELS.listFiles, (path: string) => engine.listFiles(path));
  handle(CHANNELS.allFiles, (path: string) => engine.allFiles(path));
  handle(CHANNELS.grepRepo, (path: string, query: string) => engine.grepRepo(path, query));
  handle(CHANNELS.searchCommits, (path: string, query: string) =>
    engine.searchCommits(path, query),
  );
  handle(CHANNELS.blame, (path: string, file: string) => engine.blame(path, file));
  handle(CHANNELS.worktrees, (path: string) => engine.worktrees(path));
  handle(CHANNELS.unpushedCommits, (path: string) => engine.unpushedCommits(path));
  handle(CHANNELS.workingStatus, (path: string) => engine.workingStatus(path));
  handle(CHANNELS.workingDiff, (path: string, file: string, staged: boolean) =>
    engine.workingDiff(path, file, staged),
  );
  handle(CHANNELS.workingFile, (path: string, file: string) => engine.workingFile(path, file));
  handle(CHANNELS.stagedDiff, (path: string) => engine.stagedDiff(path));

  handle(CHANNELS.repoDirty, async (path: string) => {
    try {
      return await engine.isDirty(path);
    } catch {
      return false; // the sidebar dot must never be the thing that errors
    }
  });

  /**
   * Dirty state for several repos in one call. The checks run sequentially on
   * purpose — the sidebar previously spawned a subprocess per recent repo
   * simultaneously at launch.
   */
  handle(CHANNELS.reposDirty, async (paths: string[]) => {
    const out: Record<string, boolean> = {};
    for (const p of paths) {
      try {
        out[p] = await engine.isDirty(p);
      } catch {
        out[p] = false;
      }
    }
    return out;
  });

  // --- Writes. Each pokes the coordinator so the refresh runs through the
  //     same pipeline as watcher events, with no racing parallel fetch. ---
  handle(CHANNELS.stageFile, async (path: string, file: string) => {
    await engine.stage(path, file);
    poke(INV_INDEX | INV_WORKDIR);
  });
  handle(CHANNELS.unstageFile, async (path: string, file: string) => {
    await engine.unstage(path, file);
    poke(INV_INDEX | INV_WORKDIR);
  });
  handle(CHANNELS.stageAll, async (path: string) => {
    await engine.stageAll(path);
    poke(INV_INDEX | INV_WORKDIR);
  });
  handle(CHANNELS.unstageAll, async (path: string) => {
    await engine.unstageAll(path);
    poke(INV_INDEX | INV_WORKDIR);
  });
  handle(CHANNELS.commitChanges, async (path: string, msg: string) => {
    const out = await engine.commit(path, msg);
    poke(INV_FULL);
    return out;
  });
  handle(CHANNELS.cloneRepo, (url: string) => engine.cloneToGroveRepos(url));

  // --- Agent ---
  handle(CHANNELS.generateCommitMessage, async (path: string) => {
    const diff = await engine.stagedDiff(path);
    if (diff.trim() === '') throw new Error('Stage some changes first.');
    return engine.generateMessage(diff);
  });

  // --- Session ---
  handle(CHANNELS.recentRepos, () => recents.list());
  handle(CHANNELS.addRecentRepo, (path: string, name: string) => recents.add(path, name));

  handle(CHANNELS.watchRepo, async (path: string) => {
    await stopWatching();

    // Claim the generation *before* starting, so the priming refresh that
    // `watchRepo` kicks off is already covered by the time it emits.
    const gen = (watchGen += 1);
    const forward = (event: RepoEventEnvelope) => {
      if (gen !== watchGen) return; // superseded by a newer watch
      const win = getWindow();
      if (win && !win.isDestroyed()) win.webContents.send(REPO_EVENT_CHANNEL, event);
    };

    const repo = engine.watchRepo(path, forward);
    watched = { gen, root: path, repo };
  });

  handle(CHANNELS.unwatchRepo, () => stopWatching());

  /** Ask the coordinator for a full refresh (e.g. after an external change). */
  handle(CHANNELS.refreshRepo, () => {
    poke(INV_FULL);
  });
}

/** Stop the watcher on shutdown so no stray subprocess outlives the window. */
export function disposeIpc(): Promise<void> {
  return stopWatching();
}
