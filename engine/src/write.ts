/**
 * Write paths: the mutations Grove performs on a repository.
 * Every one of these goes through `git()`, so every one inherits the
 * index-lock retry. Ported from `src-tauri/src/repo/write.rs`.
 */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { workdirOf } from './discover.ts';
import { git, gitBare } from './git.ts';

/** Stage one file (`git add`). */
export async function stage(path: string, file: string): Promise<void> {
  await git(workdirOf(path), ['add', '--', file]);
}

/** Unstage one file (`git restore --staged`). */
export async function unstage(path: string, file: string): Promise<void> {
  await git(workdirOf(path), ['restore', '--staged', '--', file]);
}

/** Stage everything (`git add -A`). */
export async function stageAll(path: string): Promise<void> {
  await git(workdirOf(path), ['add', '-A']);
}

/** Unstage everything (`git reset`). */
export async function unstageAll(path: string): Promise<void> {
  await git(workdirOf(path), ['reset']);
}

/** Commit the staged changes with `message`. */
export function commit(path: string, message: string): Promise<string> {
  return git(workdirOf(path), ['commit', '-m', message]);
}

/** Clone `url` into `dest` (a directory that must not already exist). */
export async function clone(url: string, dest: string): Promise<void> {
  await gitBare(['clone', url, dest]);
}

function homeDir(): string {
  return process.env['USERPROFILE'] || process.env['HOME'] || '.';
}

/**
 * Clone `url` into `~/GroveRepos/<name>` and return the local path.
 * Ported from the `clone_repo` command in `lib.rs`.
 */
export async function cloneToGroveRepos(url: string): Promise<string> {
  const name = url.replace(/\/+$/, '').split('/').pop()?.replace(/\.git$/, '') ?? '';
  if (name === '') throw new Error('could not derive a repo name from the URL');

  const parent = join(homeDir(), 'GroveRepos');
  mkdirSync(parent, { recursive: true });

  const dest = join(parent, name);
  if (existsSync(dest)) throw new Error(`${dest} already exists`);

  await clone(url, dest);
  return dest;
}

/**
 * Best-effort `git commit-graph write --reachable`, once per repo per session,
 * in the background. The commit-graph file gives the git CLI generation-number
 * traversal, which speeds up every log/walk on large histories.
 */
const commitGraphDone = new Set<string>();

export function maybeWriteCommitGraph(path: string): void {
  if (commitGraphDone.has(path)) return;
  commitGraphDone.add(path);
  // Deliberately not awaited: this is a warm-up, not a dependency.
  void git(path, ['commit-graph', 'write', '--reachable']).catch(() => {});
}
