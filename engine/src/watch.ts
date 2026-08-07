/**
 * File watcher: classifies filesystem events into repo-state invalidations and
 * feeds them to the repo service. Classifying (rather than just filtering
 * noise and refreshing everything) means a ref update only recomputes the
 * graph, a workdir save only recomputes status, and `.git/index` changes are
 * *seen* — which is exactly the signal that an agent staged files.
 *
 * Ported from `src-tauri/src/repo/watch.rs`.
 */

import chokidar, { type FSWatcher } from 'chokidar';

import { INV_INDEX, INV_REFS, INV_WORKDIR, INV_WORKTREES } from './types.ts';

/**
 * High-volume build/dependency directories. `classify` rejects these too, but
 * listing them here lets chokidar skip descending into them at all — on a repo
 * with a populated `node_modules` that is the difference between watching a
 * few thousand paths and a few hundred thousand.
 *
 * This is a fixed list rather than the repo's own .gitignore, which is the
 * honest limitation: a tracked file inside a directory named like one of these
 * will not trigger a live refresh, though it still appears in status on the
 * next cycle. Reading .gitignore properly means honouring nested files, the
 * global excludes file, and .git/info/exclude, and doing it per path during a
 * synchronous traversal — worth doing, but not worth guessing at here.
 */
const NOISY_DIRS = [
  'node_modules',
  'target',
  'dist',
  'build',
  'out',
  'release',
  'coverage',
  '.svelte-kit',
  '.next',
  '.turbo',
  '__pycache__',
  '.venv',
] as const;

/** Map one event path to invalidation bits (0 = noise, ignore). */
export function classify(path: string): number {
  const s = path.replace(/\\/g, '/');

  if (s.endsWith('/.git')) return 0;

  const i = s.indexOf('/.git/');
  if (i !== -1) {
    const g = s.slice(i + 6);
    if (g.endsWith('.lock')) return 0; // index.lock et al: transient, never a state change
    if (g === 'index') return INV_INDEX;
    if (g === 'HEAD' || g === 'packed-refs' || g.startsWith('refs/')) return INV_REFS;
    if (g.startsWith('worktrees/')) return INV_WORKTREES;
    // objects/, logs/, FETCH_HEAD, COMMIT_EDITMSG, ORIG_HEAD, config, ... are
    // internal churn; the states they imply always surface via refs or the
    // index as well.
    return 0;
  }

  // Working-tree path. The watcher does not honour .gitignore, so drop the
  // high-volume build/dependency dirs that would otherwise flood us.
  for (const d of NOISY_DIRS) if (s.includes(`/${d}/`)) return 0;

  return INV_WORKDIR;
}

/**
 * Subtrees of `.git` that `classify` always scores as noise, so watching them
 * is pure cost. `objects/` is the one that matters: it is the largest directory
 * in most repositories by file count, and on a big history it is tens of
 * thousands of paths the watcher would otherwise stat and hold handles on for
 * events we discard on arrival.
 */
const GIT_NOISE = ['objects', 'logs', 'lfs', 'modules'] as const;

/** True if chokidar should not descend into this path at all. */
export function isNoisyPath(path: string): boolean {
  const s = path.replace(/\\/g, '/');
  for (const d of NOISY_DIRS) if (s.endsWith(`/${d}`) || s.includes(`/${d}/`)) return true;

  const g = s.indexOf('/.git/');
  if (g !== -1) {
    const rest = s.slice(g + 6);
    for (const d of GIT_NOISE) if (rest === d || rest.startsWith(`${d}/`)) return true;
  }
  return false;
}

export interface Watcher {
  close(): Promise<void>;
}

/**
 * Watch `root` recursively, calling `poke` with classified invalidations.
 * Closing the returned watcher stops it.
 */
export function startWatcher(root: string, poke: (bits: number) => void): Watcher {
  const watcher: FSWatcher = chokidar.watch(root, {
    // Parity with the Rust `notify` watcher, which never emitted events for
    // files that already existed. Without this, opening a repo fires one
    // event per tracked file.
    ignoreInitial: true,
    persistent: true,
    ignored: (p: string) => isNoisyPath(p),
  });

  const onEvent = (p: string) => {
    const bits = classify(p);
    if (bits !== 0) poke(bits);
  };

  watcher.on('add', onEvent);
  watcher.on('change', onEvent);
  watcher.on('unlink', onEvent);
  watcher.on('addDir', onEvent);
  watcher.on('unlinkDir', onEvent);
  // A watch error (a directory vanishing mid-scan) must not take down the
  // process; the next real event still arrives.
  watcher.on('error', () => {});

  return { close: () => watcher.close() };
}
