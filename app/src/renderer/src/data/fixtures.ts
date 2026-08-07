/**
 * Fixture data for browser mode.
 *
 * `npm run dev:renderer` serves the UI in a plain browser, where there is no
 * Electron preload and therefore no `window.grove`. Rather than render an
 * error state, we serve this — so the interface can be designed and reviewed
 * without launching the shell. It is real data shape, taken from Grove's own
 * history, so layouts are exercised against realistic string lengths.
 */

import type {
  CommitNode,
  DirListing,
  RecentRepo,
  RepoSummary,
  WorkingStatus,
  Worktree,
} from '@grove/engine';

const HOUR = 3600;
const now = 1786120000;

export const FIXTURE_REPO: RepoSummary = {
  path: 'C:/Users/capad/Desktop/Grove/.git',
  workdir: 'C:/Users/capad/Desktop/Grove',
  is_bare: false,
  head: 'reauthor',
};

export const FIXTURE_COMMITS: CommitNode[] = [
  ['1bbab29', 'Shell: add a browser-previewable renderer dev server', 'capad.fyi', 0.4, ['reauthor']],
  ['8a6a490', 'Shell: Electron main + hardened preload bridge (phase 3)', 'capad.fyi', 1.2, []],
  ['a97c354', 'Engine: port the git engine to Node/TypeScript (phase 1)', 'capad.fyi', 3.5, []],
  ['b030f34', 'docs: add RUNBOOK with setup, startup fixes, and deploy steps', 'capad.fyi', 26, []],
  ['3ae9317', 'Engine: cheap heavy-repo wins', 'capad.fyi', 28, []],
  ['c41d0a8', 'Engine: lock hardening at the git boundary', 'capad.fyi', 30, []],
  ['9f2b117', 'Engine: refresh coordinator with typed events', 'capad.fyi', 33, []],
  ['5ec8d40', 'Worktrees: ahead/behind and dirty state per tree', 'capad.fyi', 49, []],
  ['77a1c93', 'Spotlight: search commits by hash, message, author', 'capad.fyi', 52, []],
  ['2d9e6b1', 'Diff: wrap toggle and copy affordances', 'capad.fyi', 55, []],
  ['ba30f77', 'chore: capad contact identity', 'capad.fyi', 72, ['main']],
  ['e8c4a20', 'Graph: lane assignment in a single pass', 'capad.fyi', 74, []],
].map(([id, summary, author, hoursAgo, refs]) => ({
  id: (id as string).padEnd(40, '0'),
  short: id as string,
  parents: [],
  author: author as string,
  time: now - (hoursAgo as number) * HOUR,
  refs: refs as string[],
  summary: summary as string,
}));

export const FIXTURE_STATUS: WorkingStatus = {
  branch: 'reauthor',
  staged: [{ path: 'app/src/renderer/src/App.tsx', status: 'A' }],
  unstaged: [
    { path: 'src-tauri/Cargo.toml', status: 'M' },
    { path: 'app/DESIGN-SYSTEM.md', status: 'M' },
  ],
  untracked: ['.coderabbit.yaml', 'AGENTS.md'],
};

export const FIXTURE_WORKTREES: Worktree[] = [
  {
    path: 'C:/Users/capad/Desktop/Grove',
    branch: 'reauthor',
    head: '1bbab29',
    is_main: true,
    detached: false,
    dirty: true,
    ahead: 3,
    behind: 0,
    has_upstream: true,
  },
  {
    path: 'C:/Users/capad/Desktop/grove-agent-1',
    branch: 'agent/diff-virtualisation',
    head: '4c81f0a',
    is_main: false,
    detached: false,
    dirty: true,
    ahead: 7,
    behind: 2,
    has_upstream: true,
  },
  {
    path: 'C:/Users/capad/Desktop/grove-agent-2',
    branch: 'agent/blame-gutter',
    head: '9ba22e5',
    is_main: false,
    detached: false,
    dirty: false,
    ahead: 0,
    behind: 4,
    has_upstream: true,
  },
];

export const FIXTURE_RECENTS: RecentRepo[] = [
  { path: 'C:/Users/capad/Desktop/Grove', name: 'Grove' },
  { path: 'C:/Users/capad/Desktop/capad-portfolio', name: 'capad-portfolio' },
  { path: 'C:/Users/capad/Desktop/grove-agent-1', name: 'grove-agent-1' },
];

export const FIXTURE_DIR: DirListing = {
  current: 'C:/Users/capad/Desktop',
  parent: 'C:/Users/capad',
  entries: [
    { name: 'Grove', path: 'C:/Users/capad/Desktop/Grove', is_dir: true, is_repo: true },
    {
      name: 'capad-portfolio',
      path: 'C:/Users/capad/Desktop/capad-portfolio',
      is_dir: true,
      is_repo: true,
    },
    { name: 'notes', path: 'C:/Users/capad/Desktop/notes', is_dir: true, is_repo: false },
    { name: 'screenshots', path: 'C:/Users/capad/Desktop/screenshots', is_dir: true, is_repo: false },
  ],
};

export const FIXTURE_DIFF = `diff --git a/engine/src/read.ts b/engine/src/read.ts
@@ -14,9 +14,11 @@ import { gitRead, gitReadOr } from './git.ts';
 /** Discover a git repository at (or above) \`path\` and summarize it. */
 export async function open(path: string): Promise<RepoSummary> {
-  const repo = gix.discover(path);
-  const workdir = repo.workdir();
-  return { path: repo.gitDir(), workdir, is_bare: !workdir };
+  const d = discover(path);
+  const head = d.workdir ? await currentBranch(d.workdir) : null;
+  return { path: d.gitDir, workdir: d.workdir, is_bare: d.isBare, head };
 }

 /**
  * Walk the commit graph across all refs, newest first, capped at \`limit\`.
  */
`;
