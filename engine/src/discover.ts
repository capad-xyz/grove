/**
 * Repository discovery — the one job `gix` was doing in the Rust engine.
 *
 * `gix::discover` walked up from a path looking for `.git`, in-process. Doing
 * the same walk here (rather than shelling out to `git rev-parse`) keeps the
 * subprocess count per operation identical to the Rust original: discovery is
 * free, and every *real* question still costs exactly one `git` invocation.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export interface Discovered {
  /** Absolute path to the `.git` directory. */
  gitDir: string;
  /** Working tree path, or `null` for a bare repo. */
  workdir: string | null;
  isBare: boolean;
}

/** Does this directory look like a bare repository? */
function looksBare(dir: string): boolean {
  return (
    existsSync(join(dir, 'HEAD')) &&
    existsSync(join(dir, 'objects')) &&
    existsSync(join(dir, 'refs'))
  );
}

/**
 * Resolve a `.git` *file* (used by linked worktrees and submodules), whose
 * contents are `gitdir: <path>`, with the path possibly relative to the file.
 */
function resolveGitFile(gitFile: string, parent: string): string | null {
  try {
    const raw = readFileSync(gitFile, 'utf8').trim();
    const target = raw.startsWith('gitdir:') ? raw.slice('gitdir:'.length).trim() : '';
    if (!target) return null;
    return isAbsolute(target) ? resolve(target) : resolve(parent, target);
  } catch {
    return null;
  }
}

/**
 * Discover the repository at or above `startPath`.
 * Throws if there is no repository anywhere up the chain.
 */
export function discover(startPath: string): Discovered {
  let dir = resolve(startPath && startPath.trim() ? startPath : '.');

  for (;;) {
    const dotGit = join(dir, '.git');
    if (existsSync(dotGit)) {
      const isDir = (() => {
        try {
          return statSync(dotGit).isDirectory();
        } catch {
          return false;
        }
      })();

      if (isDir) return { gitDir: dotGit, workdir: dir, isBare: false };

      const linked = resolveGitFile(dotGit, dir);
      if (linked) return { gitDir: linked, workdir: dir, isBare: false };
    }

    // A path pointing straight at a bare repo (or at a `.git` directory).
    if (looksBare(dir)) return { gitDir: dir, workdir: null, isBare: true };

    const parent = dirname(dir);
    if (parent === dir) throw new Error('not a git repository');
    dir = parent;
  }
}

/** Resolve the directory to run `git -C` in for a repo at `path`. */
export function workdirOf(path: string): string {
  const d = discover(path);
  return d.workdir ?? d.gitDir;
}
