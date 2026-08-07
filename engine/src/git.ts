/**
 * The single boundary where Grove talks to git.
 *
 * Every read and every write in the engine goes through here: we invoke the
 * user's installed `git` binary as a subprocess and parse its stdout. This is a
 * port of `src-tauri/src/repo/write.rs`, and it keeps that file's two pieces of
 * hard-won behaviour — the index-lock retry and `--no-optional-locks` on reads —
 * because both exist to survive an agent writing to the repo underneath us.
 */

import { spawn } from 'node:child_process';

/**
 * Backoff schedule for retrying a git command that lost the race for the index
 * lock (an agent committing while the user stages, or vice versa).
 */
const LOCK_RETRY_MS = [100, 300, 800, 1500] as const;

/** Error thrown when git exits non-zero. Carries stderr for classification. */
export class GitError extends Error {
  readonly stderr: string;
  readonly code: number | null;

  constructor(args: readonly string[], stderr: string, code: number | null) {
    super(`git ${args.join(' ')} failed: ${stderr.trim()}`);
    this.name = 'GitError';
    this.stderr = stderr;
    this.code = code;
  }
}

/**
 * Does this stderr indicate transient lock contention (safe to retry)?
 * We never delete the lock file ourselves — the other process owns it.
 */
export function isLockError(stderr: string): boolean {
  const m = stderr.toLowerCase();
  return (
    m.includes('index.lock') ||
    m.includes('another git process') ||
    (m.includes('unable to create') && m.includes('.lock'))
  );
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Spawn git once and collect its output.
 *
 * We stream into buffers rather than using `execFile` because `execFile` caps
 * output at `maxBuffer` and *truncates* past it. `git log --all --name-only` on
 * a large repo blows through any cap we'd pick, and a silently short answer is
 * worse than a slow one. The Rust original had no cap either.
 */
function runOnce(workdir: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-C', workdir, ...args], {
      // Windows GUI apps otherwise flash a console window on every git call.
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdout.push(c));
    child.stderr.on('data', (c: Buffer) => stderr.push(c));

    child.on('error', reject);
    child.on('close', (code) => {
      // `toString('utf8')` substitutes U+FFFD for invalid sequences, matching
      // Rust's `String::from_utf8_lossy`. Commit messages are not always UTF-8.
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new GitError(args, err, code));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}

async function gitWithRetry(
  workdir: string,
  extra: readonly string[],
  args: readonly string[],
): Promise<string> {
  const full = [...extra, ...args];
  for (let attempt = 0; ; attempt++) {
    try {
      return await runOnce(workdir, full);
    } catch (e) {
      const retryable =
        attempt < LOCK_RETRY_MS.length && e instanceof GitError && isLockError(e.stderr);
      if (!retryable) throw e;
      await sleep(LOCK_RETRY_MS[attempt]!);
    }
  }
}

/**
 * Run `git -C <workdir> <args...>` and return stdout on success.
 * Retries briefly on index-lock contention.
 */
export function git(workdir: string, args: readonly string[]): Promise<string> {
  return gitWithRetry(workdir, [], args);
}

/**
 * Read-path variant: `--no-optional-locks` stops git from taking its
 * opportunistic locks (e.g. the status untracked-cache refresh), so reads can
 * never collide with an agent mid-commit. Designed exactly for tools like
 * Grove that run status in the background.
 */
export function gitRead(workdir: string, args: readonly string[]): Promise<string> {
  return gitWithRetry(workdir, ['--no-optional-locks'], args);
}

/**
 * `gitRead` that yields `fallback` instead of throwing. Several read paths use
 * commands that exit non-zero for ordinary reasons — `git grep` with no
 * matches, `rev-list` with no upstream — where an empty result is the answer.
 */
export async function gitReadOr(
  workdir: string,
  args: readonly string[],
  fallback = '',
): Promise<string> {
  try {
    return await gitRead(workdir, args);
  } catch {
    return fallback;
  }
}

/** Run git outside any repository (for `clone`, which has no workdir yet). */
export function gitBare(args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], { windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdout.push(c));
    child.stderr.on('data', (c: Buffer) => stderr.push(c));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new GitError(args, Buffer.concat(stderr).toString('utf8'), code));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8'));
    });
  });
}
