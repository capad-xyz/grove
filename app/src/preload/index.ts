/**
 * The bridge. This is the only thing the renderer can reach, and it is the
 * whole reason `nodeIntegration` can stay off: page script gets these methods
 * and nothing else — no `require`, no `ipcRenderer`, no filesystem.
 *
 * Typing the object as `GroveApi` makes coverage a compile-time property: a
 * method missing here is a type error, not a runtime `undefined is not a
 * function` discovered by a user.
 */

import { contextBridge, ipcRenderer, webUtils } from 'electron';

import { CHANNELS, REPO_EVENT_CHANNEL, type GroveApi } from '../shared/ipc';

const api: GroveApi = {
  // --- Reads ---
  openRepo: (path) => ipcRenderer.invoke(CHANNELS.openRepo, path),
  commitGraph: (path, limit, refspec) =>
    ipcRenderer.invoke(CHANNELS.commitGraph, path, limit, refspec),
  branches: (path) => ipcRenderer.invoke(CHANNELS.branches, path),
  commitDetail: (path, oid) => ipcRenderer.invoke(CHANNELS.commitDetail, path, oid),
  commitDiff: (path, oid) => ipcRenderer.invoke(CHANNELS.commitDiff, path, oid),
  fileBytesAt: (path, rev, file) => ipcRenderer.invoke(CHANNELS.fileBytesAt, path, rev, file),
  fileDiff: (path, oid, file) => ipcRenderer.invoke(CHANNELS.fileDiff, path, oid, file),
  fileDiffBetween: (path, a, b, file) =>
    ipcRenderer.invoke(CHANNELS.fileDiffBetween, path, a, b, file),
  fileAt: (path, rev, file) => ipcRenderer.invoke(CHANNELS.fileAt, path, rev, file),
  fileHistory: (path, file) => ipcRenderer.invoke(CHANNELS.fileHistory, path, file),
  listDir: (path) => ipcRenderer.invoke(CHANNELS.listDir, path),
  listFiles: (path) => ipcRenderer.invoke(CHANNELS.listFiles, path),
  allFiles: (path) => ipcRenderer.invoke(CHANNELS.allFiles, path),
  grepRepo: (path, query) => ipcRenderer.invoke(CHANNELS.grepRepo, path, query),
  searchCommits: (path, query) => ipcRenderer.invoke(CHANNELS.searchCommits, path, query),
  blame: (path, file) => ipcRenderer.invoke(CHANNELS.blame, path, file),
  worktrees: (path) => ipcRenderer.invoke(CHANNELS.worktrees, path),
  unpushedCommits: (path) => ipcRenderer.invoke(CHANNELS.unpushedCommits, path),
  workingStatus: (path) => ipcRenderer.invoke(CHANNELS.workingStatus, path),
  workingDiff: (path, file, staged) =>
    ipcRenderer.invoke(CHANNELS.workingDiff, path, file, staged),
  workingFile: (path, file) => ipcRenderer.invoke(CHANNELS.workingFile, path, file),
  workingFileBytes: (path, file) => ipcRenderer.invoke(CHANNELS.workingFileBytes, path, file),
  workingFilePreview: (path, file) => ipcRenderer.invoke(CHANNELS.workingFilePreview, path, file),
  stagedDiff: (path) => ipcRenderer.invoke(CHANNELS.stagedDiff, path),
  repoDirty: (path) => ipcRenderer.invoke(CHANNELS.repoDirty, path),
  reposDirty: (paths) => ipcRenderer.invoke(CHANNELS.reposDirty, paths),

  // --- Writes ---
  stageFile: (path, file) => ipcRenderer.invoke(CHANNELS.stageFile, path, file),
  unstageFile: (path, file) => ipcRenderer.invoke(CHANNELS.unstageFile, path, file),
  stageAll: (path) => ipcRenderer.invoke(CHANNELS.stageAll, path),
  unstageAll: (path) => ipcRenderer.invoke(CHANNELS.unstageAll, path),
  commitChanges: (path, message) => ipcRenderer.invoke(CHANNELS.commitChanges, path, message),
  cloneRepo: (url) => ipcRenderer.invoke(CHANNELS.cloneRepo, url),

  // --- OS integration ---
  writeClipboard: (text) => ipcRenderer.invoke(CHANNELS.writeClipboard, text),

  // --- Agent ---
  generateCommitMessage: (path) => ipcRenderer.invoke(CHANNELS.generateCommitMessage, path),

  pickDirectory: () => ipcRenderer.invoke(CHANNELS.pickDirectory),
  knownRoots: () => ipcRenderer.invoke(CHANNELS.knownRoots),

  /**
   * Resolve a dropped folder to a real path.
   *
   * Electron removed `File.path` in v32; `webUtils.getPathForFile` is the
   * replacement and it only exists in the preload, which is exactly the point —
   * page script never gets a way to turn a File into a filesystem path.
   */
  pathForDropped: (file) => {
    try {
      return webUtils.getPathForFile(file) || null;
    } catch {
      return null;
    }
  },

  // --- Session ---
  recentRepos: () => ipcRenderer.invoke(CHANNELS.recentRepos),
  addRecentRepo: (path, name) => ipcRenderer.invoke(CHANNELS.addRecentRepo, path, name),
  watchRepo: (path) => ipcRenderer.invoke(CHANNELS.watchRepo, path),
  unwatchRepo: () => ipcRenderer.invoke(CHANNELS.unwatchRepo),
  refreshRepo: () => ipcRenderer.invoke(CHANNELS.refreshRepo),

  onRepoEvent: (listener) => {
    // Only the payload crosses over. The `IpcRendererEvent` first argument
    // carries a `sender` handle, and handing that to page script would give it
    // a way to talk to main directly — the exact thing context isolation is
    // there to prevent.
    const handler = (_event: unknown, payload: Parameters<typeof listener>[0]) =>
      listener(payload);

    ipcRenderer.on(REPO_EVENT_CHANNEL, handler);
    return () => {
      ipcRenderer.off(REPO_EVENT_CHANNEL, handler);
    };
  },
};

contextBridge.exposeInMainWorld('grove', api);
