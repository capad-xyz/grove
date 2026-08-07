/**
 * Headless smoke test for the IPC bridge.
 *
 * Run with `npm run smoke`. It drives the *real* path — page script calls
 * `window.grove.*`, which crosses contextBridge → ipcRenderer → ipcMain →
 * engine and back — so it proves the wiring end to end rather than proving the
 * engine works (which the engine's own suite already covers).
 *
 * It exists because the shell is otherwise only verifiable by a human looking
 * at a window, and "someone looked at it once" is not a regression test.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BrowserWindow } from 'electron';

interface Check {
  name: string;
  /** Runs in the renderer. Returns a short human-readable result string. */
  script: string;
}

/** `repo` is injected as a JS string literal into each snippet. */
function checks(repo: string): Check[] {
  const r = JSON.stringify(repo);
  return [
    {
      name: 'bridge exposed',
      script: `(() => {
        const n = window.grove ? Object.keys(window.grove).length : 0;
        if (n === 0) throw new Error('window.grove is missing');
        return n + ' methods';
      })()`,
    },
    {
      name: 'renderer has no node access',
      script: `(() => {
        if (typeof window.require !== 'undefined') throw new Error('window.require is exposed');
        if (typeof window.process !== 'undefined') throw new Error('window.process is exposed');
        if (typeof window.module !== 'undefined') throw new Error('window.module is exposed');
        return 'require/process/module all absent';
      })()`,
    },
    {
      name: 'openRepo',
      script: `window.grove.openRepo(${r}).then(s => 'head=' + s.head + ' bare=' + s.is_bare)`,
    },
    {
      name: 'commitGraph',
      script: `window.grove.commitGraph(${r}, 20, null).then(c => c.length + ' commits, newest: ' + JSON.stringify(c[0].summary))`,
    },
    {
      name: 'branches',
      script: `window.grove.branches(${r}).then(b => b.join(', '))`,
    },
    {
      name: 'workingStatus',
      script: `window.grove.workingStatus(${r}).then(s =>
        s.staged.length + ' staged / ' + s.unstaged.length + ' unstaged / ' + s.untracked.length + ' untracked')`,
    },
    {
      name: 'worktrees',
      script: `window.grove.worktrees(${r}).then(w => w.length + ' worktree(s), main=' + w[0].branch)`,
    },
    {
      name: 'commitDetail',
      script: `window.grove.commitGraph(${r}, 1, null)
        .then(c => window.grove.commitDetail(${r}, c[0].id))
        .then(d => d.short + ' by ' + d.author + ', ' + d.files.length + ' file(s)')`,
    },
    {
      name: 'error propagates as a message',
      script: `window.grove.openRepo('C:/definitely/not/a/repo')
        .then(() => { throw new Error('expected a rejection'); })
        .catch(e => /not a git repository/.test(e.message)
          ? 'rejected: not a git repository'
          : (() => { throw new Error('wrong error: ' + e.message) })())`,
    },
    {
      name: 'watchRepo emits live coordinator events',
      script: `new Promise((resolve, reject) => {
        const seen = [];
        const off = window.grove.onRepoEvent(e => {
          seen.push(e.kind);
          // The priming refresh emits every slice; branches is emitted last.
          if (e.kind === 'branches_changed') {
            off();
            window.grove.unwatchRepo();
            resolve(seen.sort().join(', '));
          }
        });
        setTimeout(() => { off(); reject(new Error('no events after 20s; saw [' + seen + ']')); }, 20000);
        window.grove.watchRepo(${r});
      })`,
    },
  ];
}

/**
 * Write checks run against a throwaway repository, never the one passed in.
 * Staging and committing into the user's actual working tree to prove the
 * button works would be a spectacularly bad trade.
 */
function scratchRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'grove-smoke-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, ...args], { windowsHide: true });

  execFileSync('git', ['init', '-b', 'main', dir], { windowsHide: true });
  git('config', 'user.email', 'smoke@grove.invalid');
  git('config', 'user.name', 'Grove Smoke');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(dir, 'seed.txt'), 'seed\n');
  git('add', '-A');
  git('commit', '-m', 'seed');

  // Leave one modified and one untracked file for the write checks to move.
  writeFileSync(join(dir, 'seed.txt'), 'seed\nchanged\n');
  writeFileSync(join(dir, 'fresh.txt'), 'fresh\n');
  return dir;
}

function writeChecks(dir: string): Check[] {
  const r = JSON.stringify(dir);
  return [
    {
      name: 'scratch repo starts dirty',
      script: `window.grove.workingStatus(${r}).then(s =>
        s.staged.length + '/' + s.unstaged.length + '/' + s.untracked.length + ' staged/unstaged/untracked')`,
    },
    {
      name: 'stageFile moves a file to staged',
      script: `window.grove.stageFile(${r}, 'seed.txt')
        .then(() => window.grove.workingStatus(${r}))
        .then(s => s.staged.some(f => f.path === 'seed.txt')
          ? 'seed.txt staged'
          : (() => { throw new Error('not staged: ' + JSON.stringify(s.staged)) })())`,
    },
    {
      name: 'unstageFile puts it back',
      script: `window.grove.unstageFile(${r}, 'seed.txt')
        .then(() => window.grove.workingStatus(${r}))
        .then(s => s.staged.length === 0 ? 'staged is empty again'
          : (() => { throw new Error('still staged') })())`,
    },
    {
      name: 'stageAll takes untracked files too',
      script: `window.grove.stageAll(${r})
        .then(() => window.grove.workingStatus(${r}))
        .then(s => s.untracked.length === 0 && s.staged.length === 2
          ? s.staged.length + ' staged, 0 untracked'
          : (() => { throw new Error(JSON.stringify(s)) })())`,
    },
    {
      name: 'commitChanges advances the graph',
      script: `window.grove.commitGraph(${r}, 50, null).then(before =>
        window.grove.commitChanges(${r}, 'test: smoke commit')
          .then(() => window.grove.commitGraph(${r}, 50, null))
          .then(after => after.length === before.length + 1 && after[0].summary === 'test: smoke commit'
            ? before.length + ' -> ' + after.length + ' commits'
            : (() => { throw new Error('graph did not advance: ' + JSON.stringify(after.map(c=>c.summary))) })()))`,
    },
    {
      name: 'working tree is clean after commit',
      script: `window.grove.repoDirty(${r}).then(d => d === false
        ? 'clean'
        : (() => { throw new Error('still dirty') })())`,
    },
  ];
}

export async function runSmoke(win: BrowserWindow, repo: string): Promise<number> {
  process.stdout.write(`\n  smoke: driving window.grove against ${repo}\n\n`);

  let scratch: string | null = null;
  try {
    scratch = scratchRepo();
  } catch (e) {
    process.stdout.write(`  WARN  could not create scratch repo, skipping write checks: ${String(e)}\n`);
  }

  const all = [...checks(repo), ...(scratch ? writeChecks(scratch) : [])];

  let failed = 0;
  for (const check of all) {
    try {
      const result = await win.webContents.executeJavaScript(check.script, true);
      process.stdout.write(`  PASS  ${check.name.padEnd(38)} ${String(result)}\n`);
    } catch (e) {
      failed += 1;
      process.stdout.write(
        `  FAIL  ${check.name.padEnd(38)} ${e instanceof Error ? e.message : String(e)}\n`,
      );
    }
  }

  if (scratch) {
    try {
      rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows keeps .git/objects read-only; a leftover temp dir is harmless.
    }
  }

  process.stdout.write(failed === 0 ? '\n  all bridge checks passed\n\n' : `\n  ${failed} failed\n\n`);
  return failed;
}
