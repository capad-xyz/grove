/**
 * Repo-state service: the single source of truth for "when does state refresh".
 *
 * One coordinator per watched repo turns classified invalidations (from the
 * file watcher, or from Grove's own write commands) into recomputed state
 * slices, compares them against the last emitted values, and pushes typed
 * events out. Every payload carries a generation number so a consumer can drop
 * anything stale. Nothing else re-fetches on its own; every refresh trigger
 * funnels through `poke`.
 *
 * Ported from `src-tauri/src/repo/service.rs`. The `AppHandle` the Rust version
 * took purely to call `emit` is now an `EmitFn` passed in by the caller, which
 * is what keeps this package free of any UI framework.
 */

import { isDeepStrictEqual } from 'node:util';

import * as read from './read.ts';
import {
  INV_INDEX,
  INV_REFS,
  INV_WORKDIR,
  INV_WORKTREES,
  type CommitNode,
  type RepoEvent,
  type RepoEventEnvelope,
  type WorkingStatus,
  type Worktree,
} from './types.ts';

/** How the coordinator hands finished events to its owner. */
export type EmitFn = (event: RepoEventEnvelope) => void;

/**
 * Coalescing window. A burst is drained while events keep arriving, but a
 * change is never sat on for more than ~350ms total. Direct user actions (a
 * lone stage click) therefore land in ~80ms, while an agent's save-storm
 * collapses into one cycle.
 */
const QUIET_MS = 80;
const MAX_COALESCE_MS = 350;

type RecvResult = { kind: 'value'; bits: number } | { kind: 'timeout' } | { kind: 'closed' };

/**
 * Unbounded single-consumer channel with a timed receive — the piece Rust got
 * from `tokio::sync::mpsc` plus `tokio::time::timeout`.
 */
class Channel {
  #queue: number[] = [];
  #waiter: ((r: RecvResult) => void) | null = null;
  #closed = false;

  send(bits: number): void {
    if (this.#closed) return;
    const w = this.#waiter;
    if (w) {
      this.#waiter = null;
      w({ kind: 'value', bits });
      return;
    }
    this.#queue.push(bits);
  }

  close(): void {
    this.#closed = true;
    const w = this.#waiter;
    if (w) {
      this.#waiter = null;
      w({ kind: 'closed' });
    }
  }

  recv(timeoutMs?: number): Promise<RecvResult> {
    const queued = this.#queue.shift();
    if (queued !== undefined) return Promise.resolve({ kind: 'value', bits: queued });
    if (this.#closed) return Promise.resolve({ kind: 'closed' });

    return new Promise<RecvResult>((resolve) => {
      let timer: NodeJS.Timeout | undefined;
      const settle = (r: RecvResult) => {
        if (timer) clearTimeout(timer);
        resolve(r);
      };
      this.#waiter = settle;

      if (timeoutMs !== undefined) {
        timer = setTimeout(() => {
          if (this.#waiter === settle) this.#waiter = null;
          settle({ kind: 'timeout' });
        }, timeoutMs);
        // A pending coalesce window should not by itself keep the process alive.
        timer.unref?.();
      }
    });
  }
}

/**
 * Last emitted values, so unchanged slices emit nothing (no spurious
 * re-renders downstream).
 */
interface Cache {
  graph?: { head: string | null; commits: CommitNode[]; unpushed: string[] };
  status?: WorkingStatus;
  worktrees?: Worktree[];
  branches?: string[];
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown };

function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  return p.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export interface RepoService {
  /** Queue an invalidation; the coordinator coalesces bursts into one cycle. */
  poke(bits: number): void;
  /** Stop the coordinator. Safe to call more than once. */
  stop(): void;
}

/**
 * Start the coordinator for `root`. Calling `stop()` closes the channel, which
 * ends the coordinator loop.
 */
export function startRepoService(root: string, emit: EmitFn): RepoService {
  const ch = new Channel();
  void coordinator(root, ch, emit);
  return {
    poke: (bits) => ch.send(bits),
    stop: () => ch.close(),
  };
}

async function coordinator(root: string, ch: Channel, emit: EmitFn): Promise<void> {
  let gen = 0;
  const cache: Cache = {};

  for (;;) {
    const first = await ch.recv();
    if (first.kind === 'closed') return;
    if (first.kind === 'timeout') continue;

    let bits = first.bits;
    const started = Date.now();
    for (;;) {
      const next = await ch.recv(QUIET_MS);
      if (next.kind === 'closed') return; // service stopped: end the loop
      if (next.kind === 'timeout') break; // quiet for QUIET_MS: run the cycle
      bits |= next.bits;
      if (Date.now() - started > MAX_COALESCE_MS) break;
    }

    gen += 1;
    await runCycle(root, bits, gen, cache, emit);
    // Invalidations that arrived mid-cycle are still queued and start the next
    // cycle immediately, so nothing is ever lost — only coalesced.
  }
}

async function runCycle(
  root: string,
  bits: number,
  gen: number,
  cache: Cache,
  emit: EmitFn,
): Promise<void> {
  const wantGraph = (bits & INV_REFS) !== 0;
  const wantStatus = (bits & (INV_INDEX | INV_WORKDIR)) !== 0;
  const wantWorktrees = (bits & (INV_REFS | INV_INDEX | INV_WORKTREES)) !== 0;
  const wantBranches = (bits & INV_REFS) !== 0;

  const send = (event: RepoEvent) => emit({ ...event, root } as RepoEventEnvelope);
  const sendErr = (op: string, e: unknown) =>
    send({ kind: 'refresh_error', gen, op, message: errText(e) });

  // Kick off every dirty slice at once, then consume the results in order.
  const graphTask = wantGraph
    ? settle(
        (async () => {
          const commits = await read.graph(root, 400, null);
          const unpushed = await read.unpushedCommits(root).catch(() => []);
          const head = await read
            .open(root)
            .then((r) => r.head)
            .catch(() => null);
          return { head, commits, unpushed };
        })(),
      )
    : null;
  const statusTask = wantStatus ? settle(read.workingStatus(root)) : null;
  const worktreesTask = wantWorktrees ? settle(read.worktrees(root)) : null;
  const branchesTask = wantBranches ? settle(read.branches(root)) : null;

  if (graphTask) {
    const r = await graphTask;
    if (!r.ok) sendErr('graph', r.error);
    else if (!isDeepStrictEqual(cache.graph, r.value)) {
      cache.graph = r.value;
      send({
        kind: 'graph_changed',
        gen,
        head: r.value.head,
        commits: r.value.commits,
        unpushed: r.value.unpushed,
      });
    }
  }

  if (statusTask) {
    const r = await statusTask;
    if (!r.ok) sendErr('status', r.error);
    else if (!isDeepStrictEqual(cache.status, r.value)) {
      cache.status = r.value;
      const s = r.value;
      const dirty = !(
        s.staged.length === 0 &&
        s.unstaged.length === 0 &&
        s.untracked.length === 0
      );
      send({ kind: 'status_changed', gen, status: s, dirty });
    }
  }

  if (worktreesTask) {
    const r = await worktreesTask;
    if (!r.ok) sendErr('worktrees', r.error);
    else if (!isDeepStrictEqual(cache.worktrees, r.value)) {
      cache.worktrees = r.value;
      send({ kind: 'worktrees_changed', gen, worktrees: r.value });
    }
  }

  if (branchesTask) {
    const r = await branchesTask;
    if (!r.ok) sendErr('branches', r.error);
    else if (!isDeepStrictEqual(cache.branches, r.value)) {
      cache.branches = r.value;
      send({ kind: 'branches_changed', gen, branches: r.value });
    }
  }
}
