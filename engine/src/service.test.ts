/**
 * Coordinator tests. These poke the service directly rather than going through
 * the watcher, so the coalescing and change-detection behaviour is tested
 * without depending on filesystem event timing.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { gitBare, git } from './git.ts';
import { startRepoService, type RepoService } from './service.ts';
import { INV_FULL, INV_WORKDIR, type RepoEventEnvelope } from './types.ts';

let repo: string;
let service: RepoService;
let events: RepoEventEnvelope[] = [];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until `pred` holds, or fail loudly rather than hanging the suite. */
async function waitFor(pred: () => boolean, what: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(25);
  }
}

/**
 * Wait until no event has arrived for `ms`, so assertions see a settled state.
 *
 * The window must exceed the coordinator's cooldown (up to 1s after a cycle),
 * or this returns "quiet" while a cycle is merely resting and its events land
 * in the middle of the next test — which is exactly what happened when the
 * cooldown was introduced.
 */
async function quiesce(ms = 1300): Promise<void> {
  let seen = -1;
  while (seen !== events.length) {
    seen = events.length;
    await sleep(ms);
  }
}

const kinds = () => events.map((e) => e.kind);

describe('refresh coordinator', () => {
  before(async () => {
    repo = mkdtempSync(join(tmpdir(), 'grove-service-'));
    await gitBare(['init', '-b', 'main', repo]);
    await git(repo, ['config', 'user.email', 'test@grove.invalid']);
    await git(repo, ['config', 'user.name', 'Grove Test']);
    await git(repo, ['config', 'commit.gpgsign', 'false']);
    writeFileSync(join(repo, 'a.txt'), 'one\n');
    await git(repo, ['add', '-A']);
    await git(repo, ['commit', '-m', 'init']);

    service = startRepoService(repo, (e) => events.push(e));
  });

  after(async () => {
    service?.stop();
    await sleep(50);
    try {
      rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows keeps .git/objects read-only; a leftover temp dir is harmless.
    }
  });

  test('a full invalidation emits every slice once, at one generation', async () => {
    service.poke(INV_FULL);
    await waitFor(() => kinds().includes('branches_changed'), 'the first full cycle');
    await quiesce();

    assert.deepEqual(new Set(kinds()),
      new Set(['graph_changed', 'status_changed', 'worktrees_changed', 'branches_changed']));
    // One cycle means one generation number across every event.
    assert.deepEqual([...new Set(events.map((e) => e.gen))], [1]);
    assert.ok(events.every((e) => e.root === repo));
  });

  test('re-poking unchanged state emits nothing', async () => {
    events = [];
    service.poke(INV_FULL);
    await quiesce();

    // The cycle ran and the generation advanced, but every slice compared
    // equal to the cache, so nothing was pushed downstream.
    assert.deepEqual(events, []);
  });

  test('a burst of pokes collapses into a single cycle', async () => {
    events = [];
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\n');

    // An agent's save-storm: many invalidations inside the coalescing window.
    for (let i = 0; i < 20; i++) service.poke(INV_WORKDIR);

    await waitFor(() => events.length > 0, 'a status refresh');
    await quiesce();

    const statuses = events.filter((e) => e.kind === 'status_changed');
    assert.equal(statuses.length, 1, `expected one status event, got ${kinds().join(', ')}`);
    assert.equal(statuses[0]?.kind === 'status_changed' && statuses[0].dirty, true);
    assert.deepEqual([...new Set(events.map((e) => e.gen))].length, 1);
  });

  test('an unrelated invalidation does not recompute the graph', async () => {
    events = [];
    writeFileSync(join(repo, 'b.txt'), 'bee\n');
    service.poke(INV_WORKDIR);
    await waitFor(() => events.length > 0, 'a status refresh');
    await quiesce();

    // INV_WORKDIR touches status only — the graph and branches are untouched,
    // which is the whole point of classifying instead of refreshing everything.
    assert.deepEqual(kinds(), ['status_changed']);
  });

  test('generation numbers increase monotonically', async () => {
    events = [];
    writeFileSync(join(repo, 'c.txt'), 'sea\n');
    service.poke(INV_WORKDIR);
    await waitFor(() => events.length > 0, 'a status refresh');
    const first = events[0]!.gen;

    writeFileSync(join(repo, 'd.txt'), 'dee\n');
    service.poke(INV_WORKDIR);
    await waitFor(() => events.length > 1, 'a second status refresh');
    await quiesce();

    assert.ok(events[1]!.gen > first, `expected ${events[1]!.gen} > ${first}`);
  });

  test('a refresh error is reported, not thrown', async () => {
    const gone = mkdtempSync(join(tmpdir(), 'grove-gone-'));
    rmSync(gone, { recursive: true, force: true });

    const errs: RepoEventEnvelope[] = [];
    const dead = startRepoService(gone, (e) => errs.push(e));
    dead.poke(INV_FULL);

    await waitFor(() => errs.length > 0, 'a refresh error', 8000);
    dead.stop();

    assert.ok(errs.every((e) => e.kind === 'refresh_error'));
    assert.ok(errs.some((e) => e.kind === 'refresh_error' && e.op === 'graph'));
  });

  test('stop() ends the coordinator', async () => {
    const local: RepoEventEnvelope[] = [];
    const s = startRepoService(repo, (e) => local.push(e));
    s.stop();

    s.poke(INV_FULL);
    await sleep(500);
    assert.deepEqual(local, []);
  });
});
