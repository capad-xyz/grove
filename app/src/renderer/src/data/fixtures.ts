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
  GrepHit,
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

const oid = (short: string) => short.padEnd(40, '0');

/**
 * Newest first. The `parents` column is what gives the graph something to
 * draw: a merge at the top, a side branch that runs for three commits, and a
 * linear tail — the shapes the lane algorithm actually has to get right.
 */
const COMMIT_ROWS: [string, string, number, string[], string[]][] = [
  ['1bbab29', 'Shell: add a browser-previewable renderer dev server', 0.4, ['reauthor'], ['8a6a490', '3ae9317']],
  ['8a6a490', 'Shell: Electron main + hardened preload bridge (phase 3)', 1.2, [], ['a97c354']],
  ['a97c354', 'Engine: port the git engine to Node/TypeScript (phase 1)', 3.5, [], ['b030f34']],
  ['3ae9317', 'Engine: cheap heavy-repo wins', 4, [], ['c41d0a8']],
  ['b030f34', 'docs: add RUNBOOK with setup, startup fixes, and deploy steps', 26, [], ['9f2b117']],
  ['c41d0a8', 'Engine: lock hardening at the git boundary', 30, [], ['9f2b117']],
  ['9f2b117', 'Engine: refresh coordinator with typed events', 33, [], ['5ec8d40']],
  ['5ec8d40', 'Worktrees: ahead/behind and dirty state per tree', 49, [], ['77a1c93']],
  ['77a1c93', 'Spotlight: search commits by hash, message, author', 52, [], ['2d9e6b1']],
  ['2d9e6b1', 'Diff: wrap toggle and copy affordances', 55, [], ['ba30f77']],
  ['ba30f77', 'chore: capad contact identity', 72, ['main'], ['e8c4a20']],
  ['e8c4a20', 'Graph: lane assignment in a single pass', 74, [], []],
];

export const FIXTURE_COMMITS: CommitNode[] = COMMIT_ROWS.map(
  ([short, summary, hoursAgo, refs, parents]) => ({
    id: oid(short),
    short,
    parents: parents.map(oid),
    author: 'capad.fyi',
    time: now - hoursAgo * HOUR,
    refs,
    summary,
  }),
);

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

export const FIXTURE_BRANCHES = ['reauthor', 'main', 'agent/blame-gutter'];

/**
 * A 2x2 PNG. Small enough to inline, real enough that the browser decodes it —
 * which is the only thing the image-diff harness needs to prove.
 */
export const FIXTURE_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAHElEQVR42mNk' +
  'YPhfz0AEYBxVSF+Fgwrpr5AAA4MDAY7wUOAAAAAASUVORK5CYII=';

/** Enough real paths to exercise ranking: shared basenames, deep nesting. */
export const FIXTURE_FILES = [
  'app/DESIGN-SYSTEM.md',
  'app/README.md',
  'app/electron-builder.yml',
  'app/src/main/index.ts',
  'app/src/main/ipc.ts',
  'app/src/main/smoke.ts',
  'app/src/preload/index.ts',
  'app/src/renderer/index.html',
  'app/src/renderer/src/App.tsx',
  'app/src/renderer/src/components/Chrome.tsx',
  'app/src/renderer/src/components/Commits.tsx',
  'app/src/renderer/src/components/Diff.tsx',
  'app/src/renderer/src/components/GraphGutter.tsx',
  'app/src/renderer/src/components/Home.tsx',
  'app/src/renderer/src/components/WorkingTree.tsx',
  'app/src/renderer/src/data/graph.ts',
  'app/src/renderer/src/data/match.ts',
  'app/src/renderer/src/data/seen.ts',
  'app/src/renderer/src/data/source.ts',
  'app/src/renderer/src/styles/app.css',
  'app/src/renderer/src/styles/tokens.css',
  'engine/src/git.ts',
  'engine/src/index.ts',
  'engine/src/parse.ts',
  'engine/src/read.ts',
  'engine/src/service.ts',
  'engine/src/watch.ts',
  'engine/src/write.ts',
  'DESIGN.md',
  'README.md',
  'RUNBOOK.md',
];

export const FIXTURE_GREP: GrepHit[] = [
  { file: 'engine/src/git.ts', line: 25, text: 'const LOCK_RETRY_MS = [100, 300, 800, 1500];' },
  { file: 'engine/src/write.ts', line: 71, text: 'export function git(workdir, args) {' },
  { file: 'app/src/main/ipc.ts', line: 44, text: 'function handle(channel, fn) {' },
  { file: 'engine/src/service.ts', line: 38, text: 'const QUIET_MS = 80;' },
];

export const FIXTURE_MARKDOWN = [
  '# Grove',
  '',
  'A **featherweight** git companion that sits beside your _AI coding editor_.',
  '',
  '## Pillars',
  '',
  '- Read-and-review, refreshing live',
  '- Worktrees as a first-class surface',
  '- Bring your own agent',
  '',
  '> Would I keep this open beside my editor?',
  '',
  'Run it with the `npm run dev` script, or see [the repo](https://github.com/capad-xyz/grove).',
  '',
  '```ts',
  'const engine = await open(repo);',
  '```',
  '',
  '---',
  '',
  '<script>alert(1)</script>',
].join(String.fromCharCode(10));

/** `__FILE__` is substituted so the harness proves the right file was asked for. */
export const FIXTURE_WORKING_DIFF = [
  'diff --git a/__FILE__ b/__FILE__',
  '@@ -1,4 +1,5 @@',
  ' export function open(path) {',
  '-  return legacy(path);',
  '+  const d = discover(path);',
  '+  return { path: d.gitDir, workdir: d.workdir };',
  ' }',
].join(String.fromCharCode(10));

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
diff --git a/app/packaging/icon.png b/app/packaging/icon.png
index 1a2b3c4..5d6e7f8 100644
Binary files a/app/packaging/icon.png and b/app/packaging/icon.png differ
diff --git a/README.md b/README.md
@@ -1,3 +1,3 @@
 # Grove
-A git companion.
+A **featherweight** git companion that sits beside your _AI coding editor_.
`;
