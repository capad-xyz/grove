/**
 * Integration tests: these drive the real `git` binary against a scratch
 * repository. They are the actual proof that the port behaves, since the
 * parsers can only ever be checked against output we wrote ourselves.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';

import { gitBare, git } from './git.ts';
import * as read from './read.ts';
import * as write from './write.ts';

let repo: string;

async function commitFile(name: string, body: string, message: string): Promise<void> {
  writeFileSync(join(repo, name), body);
  await git(repo, ['add', '--', name]);
  await git(repo, ['commit', '-m', message]);
}

describe('engine against a real repository', () => {
  before(async () => {
    repo = mkdtempSync(join(tmpdir(), 'grove-engine-'));
    await gitBare(['init', '-b', 'main', repo]);
    // Local config only: the test must not depend on (or touch) the user's own.
    await git(repo, ['config', 'user.email', 'test@grove.invalid']);
    await git(repo, ['config', 'user.name', 'Grove Test']);
    await git(repo, ['config', 'commit.gpgsign', 'false']);

    await commitFile('a.txt', 'one\ntwo\nthree\n', 'feat: add a.txt');
    await commitFile('b.txt', 'bee\n', 'feat(b): add b.txt');
  });

  after(() => {
    try {
      rmSync(repo, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows keeps .git/objects read-only; a leftover temp dir is harmless.
    }
  });

  test('open discovers the repo and its branch', async () => {
    const s = await read.open(repo);
    assert.equal(s.is_bare, false);
    assert.equal(s.head, 'main');
    assert.ok(s.workdir);
    assert.match(s.path, /\.git$/);
  });

  test('open discovers from a subdirectory too', async () => {
    // Discovery walks up, so any path inside the repo resolves to its workdir.
    const sub = join(repo, 'nested', 'deeper');
    mkdirSync(sub, { recursive: true });

    assert.equal(read.workdirOf(sub), read.workdirOf(repo));
    assert.equal((await read.open(sub)).head, 'main');
  });

  test('graph returns commits newest first', async () => {
    const commits = await read.graph(repo, 400, null);
    assert.equal(commits.length, 2);
    assert.equal(commits[0]?.summary, 'feat(b): add b.txt');
    assert.equal(commits[1]?.summary, 'feat: add a.txt');
    assert.equal(commits[0]?.author, 'Grove Test');
    assert.ok(commits[0]!.time > 0);
    // The newest commit's parent is the older one, and the root has none.
    assert.deepEqual(commits[0]?.parents, [commits[1]!.id]);
    assert.deepEqual(commits[1]?.parents, []);
    assert.ok(commits[0]?.refs.includes('main'));
  });

  test('branches lists local heads', async () => {
    assert.deepEqual(await read.branches(repo), ['main']);
  });

  test('commitDetail reports metadata and changed files', async () => {
    const [head] = await read.graph(repo, 1, null);
    const d = await read.commitDetail(repo, head!.id);

    assert.equal(d.subject, 'feat(b): add b.txt');
    assert.equal(d.email, 'test@grove.invalid');
    assert.equal(d.files.length, 1);
    assert.equal(d.files[0]?.path, 'b.txt');
    assert.equal(d.files[0]?.status, 'A');
    assert.equal(d.files[0]?.additions, 1);
  });

  test('commitDetail on the root commit diffs against the empty tree', async () => {
    const commits = await read.graph(repo, 400, null);
    const root = commits[commits.length - 1]!;
    const d = await read.commitDetail(repo, root.id);

    assert.equal(d.files.length, 1);
    assert.equal(d.files[0]?.path, 'a.txt');
    assert.equal(d.files[0]?.additions, 3);
  });

  test('commitDetail preserves a multi-paragraph body', async () => {
    const body = 'first paragraph\n\nsecond paragraph\n\nthird';
    writeFileSync(join(repo, 'c.txt'), 'sea\n');
    await git(repo, ['add', '--', 'c.txt']);
    await git(repo, ['commit', '-m', `subject line\n\n${body}`]);

    const [head] = await read.graph(repo, 1, null);
    const d = await read.commitDetail(repo, head!.id);

    assert.equal(d.subject, 'subject line');
    assert.equal(d.body, body); // the splitN case: nothing truncated
  });

  test('fileDiff returns a unified diff', async () => {
    const [head] = await read.graph(repo, 1, null);
    const diff = await read.fileDiff(repo, head!.id, 'c.txt');
    assert.match(diff, /\+sea/);
  });

  test('blame attributes every line', async () => {
    const lines = await read.blame(repo, 'a.txt');
    assert.equal(lines.length, 3);
    assert.deepEqual(
      lines.map((l) => l.text),
      ['one', 'two', 'three'],
    );
    assert.equal(lines[0]?.author, 'Grove Test');
    assert.equal(lines[0]?.summary, 'feat: add a.txt');
    assert.equal(lines[0]?.short.length, 7);
    assert.deepEqual(
      lines.map((l) => l.line),
      [1, 2, 3],
    );
  });

  test('listFiles and allFiles see tracked paths', async () => {
    const tracked = await read.listFiles(repo);
    assert.deepEqual(tracked.sort(), ['a.txt', 'b.txt', 'c.txt']);
    const all = await read.allFiles(repo);
    for (const f of tracked) assert.ok(all.includes(f));
  });

  test('grepRepo finds content, and misses return empty', async () => {
    const hits = await read.grepRepo(repo, 'two');
    assert.equal(hits.length, 1);
    assert.equal(hits[0]?.file, 'a.txt');
    assert.equal(hits[0]?.line, 2);
    assert.equal(hits[0]?.text, 'two');

    // `git grep` exits non-zero with no matches; that must read as "no hits".
    assert.deepEqual(await read.grepRepo(repo, 'nothing-matches-this'), []);
    assert.deepEqual(await read.grepRepo(repo, '   '), []);
  });

  test('searchCommits matches by message, author, and hash', async () => {
    assert.ok((await read.searchCommits(repo, 'add b.txt')).length >= 1);
    assert.ok((await read.searchCommits(repo, 'Grove Test')).length >= 1);

    const [head] = await read.graph(repo, 1, null);
    const byHash = await read.searchCommits(repo, head!.short);
    assert.ok(byHash.some((c) => c.id === head!.id));

    assert.deepEqual(await read.searchCommits(repo, ''), []);
  });

  test('fileHistory follows a file', async () => {
    const hist = await read.fileHistory(repo, 'a.txt');
    assert.equal(hist.length, 1);
    assert.equal(hist[0]?.summary, 'feat: add a.txt');
  });

  test('worktrees reports the main tree', async () => {
    const wts = await read.worktrees(repo);
    assert.equal(wts.length, 1);
    assert.equal(wts[0]?.is_main, true);
    assert.equal(wts[0]?.branch, 'main');
    assert.equal(wts[0]?.detached, false);
    // No remote configured, so there is no upstream to compare against.
    assert.equal(wts[0]?.has_upstream, false);
  });

  test('unpushedCommits lists everything with no remote', async () => {
    const unpushed = await read.unpushedCommits(repo);
    const all = await read.graph(repo, 400, null);
    assert.equal(unpushed.length, all.length);
  });

  test('working status tracks staged, unstaged, and untracked', async () => {
    assert.equal(await read.isDirty(repo), false);

    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\n'); // unstaged edit
    writeFileSync(join(repo, 'untracked.txt'), 'hi\n'); // untracked
    await write.stage(repo, 'a.txt');
    writeFileSync(join(repo, 'a.txt'), 'one\ntwo\nthree\nfour\nfive\n'); // now both

    const s = await read.workingStatus(repo);
    assert.equal(s.branch, 'main');
    assert.ok(s.staged.some((f) => f.path === 'a.txt'));
    assert.ok(s.unstaged.some((f) => f.path === 'a.txt'));
    assert.ok(s.untracked.includes('untracked.txt'));
    assert.equal(await read.isDirty(repo), true);

    const staged = await read.stagedDiff(repo);
    assert.match(staged, /\+four/);
    assert.match(await read.workingDiff(repo, 'a.txt', true), /\+four/);
    assert.match(await read.workingDiff(repo, 'a.txt', false), /\+five/);
    assert.equal(read.workingFile(repo, 'untracked.txt'), 'hi\n');
    assert.equal(read.workingFile(repo, 'does-not-exist.txt'), '');
  });

  test('unstage and stageAll move files between groups', async () => {
    await write.unstage(repo, 'a.txt');
    let s = await read.workingStatus(repo);
    assert.equal(s.staged.length, 0);

    await write.stageAll(repo);
    s = await read.workingStatus(repo);
    assert.ok(s.staged.some((f) => f.path === 'a.txt'));
    assert.ok(s.staged.some((f) => f.path === 'untracked.txt'));
    assert.equal(s.untracked.length, 0);

    await write.unstageAll(repo);
    s = await read.workingStatus(repo);
    assert.equal(s.staged.length, 0);
  });

  test('commit advances the graph', async () => {
    const before = (await read.graph(repo, 400, null)).length;
    await write.stageAll(repo);
    await write.commit(repo, 'chore: commit the rest');

    const after = await read.graph(repo, 400, null);
    assert.equal(after.length, before + 1);
    assert.equal(after[0]?.summary, 'chore: commit the rest');
    assert.equal(await read.isDirty(repo), false);
  });

  test('opening a non-repository fails', async () => {
    const plain = mkdtempSync(join(tmpdir(), 'grove-plain-'));
    try {
      await assert.rejects(() => read.open(plain), /not a git repository/);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
