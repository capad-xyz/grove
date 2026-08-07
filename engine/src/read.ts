/**
 * Read paths. Discovery happens in-process (`discover.ts`); every actual
 * question costs exactly one `git` invocation, run with `--no-optional-locks`
 * so a background refresh can never collide with an agent mid-commit.
 *
 * Ported from `src-tauri/src/repo/read.rs`.
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { discover, workdirOf } from './discover.ts';
import { gitRead, gitReadOr } from './git.ts';
import {
  FS,
  commitFormat,
  isBlameHeader,
  parseCommitRecords,
  parsePorcelainStatus,
  parseRawNumstat,
  parseWorktreeList,
  splitN,
  trimEndChars,
} from './parse.ts';
import type {
  BlameLine,
  CommitDetail,
  CommitNode,
  DirEntry,
  DirListing,
  GrepHit,
  RepoSummary,
  WorkingStatus,
  Worktree,
} from './types.ts';

/** Git's empty-tree object, used as the diff base for root commits. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export { workdirOf };

/** Discover a git repository at (or above) `path` and summarize it. */
export async function open(path: string): Promise<RepoSummary> {
  const d = discover(path);
  const head = d.workdir ? await currentBranch(d.workdir) : null;
  return { path: d.gitDir, workdir: d.workdir, is_bare: d.isBare, head };
}

/**
 * Walk the commit graph across all refs, newest first, capped at `limit`.
 * Returned in topological order so the frontend can assign lanes in one pass.
 */
export async function graph(
  path: string,
  limit: number,
  refspec?: string | null,
): Promise<CommitNode[]> {
  const dir = workdirOf(path);
  // Either all refs, or a single branch/ref's history.
  const target = refspec && refspec.length > 0 ? refspec : '--all';
  const out = await gitRead(dir, [
    'log',
    target,
    '--topo-order',
    '--decorate=full',
    '-n',
    String(limit),
    commitFormat(),
  ]);
  return parseCommitRecords(out);
}

/** Local branch names, most-recently-committed first. */
export async function branches(path: string): Promise<string[]> {
  const dir = workdirOf(path);
  const out = await gitRead(dir, [
    'for-each-ref',
    '--format=%(refname:short)',
    '--sort=-committerdate',
    'refs/heads',
  ]);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Short branch name for the working tree, or `null` if detached/unknown. */
async function currentBranch(workdir: string): Promise<string | null> {
  const out = await gitReadOr(workdir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = out.trim();
  return name === '' || name === 'HEAD' ? null : name;
}

/** Metadata + changed-file list for one commit. */
export async function commitDetail(path: string, oid: string): Promise<CommitDetail> {
  const dir = workdirOf(path);

  // One `git show` carries metadata *and* the parent list (%P), so we can pick
  // the diff base without a separate `rev-parse` round-trip.
  const meta = await gitRead(dir, [
    'show',
    '-s',
    `--format=%H${FS}%h${FS}%an${FS}%ae${FS}%at${FS}%P${FS}%s${FS}%b`,
    oid,
  ]);
  const f = splitN(trimEndChars(meta, '\n'), FS, 8);
  if (f.length < 7) throw new Error('unexpected commit metadata');

  // Diff against the first parent (or empty tree) so merges and roots behave
  // consistently with fileDiff. Parents come straight from %P above.
  const base = f[5]!.split(/\s+/).filter(Boolean)[0] ?? EMPTY_TREE;
  const changes = await gitRead(dir, ['diff', '--raw', '--numstat', base, oid]);

  const date = Number.parseInt(f[4]!, 10);
  return {
    id: f[0]!,
    short: f[1]!,
    author: f[2]!,
    email: f[3]!,
    date: Number.isNaN(date) ? 0 : date,
    subject: f[6]!,
    body: (f[7] ?? '').trimEnd(),
    files: parseRawNumstat(changes),
  };
}

/**
 * The diff base for a commit: its first parent if it has one, otherwise git's
 * empty-tree object (so a root commit shows as all additions).
 */
async function diffBase(dir: string, oid: string): Promise<string> {
  const parent = `${oid}^`;
  try {
    await gitRead(dir, ['rev-parse', '--verify', '-q', parent]);
    return parent;
  } catch {
    return EMPTY_TREE;
  }
}

/**
 * Unified diff for a single file in a commit, against its first parent (or the
 * empty tree for a root commit). This makes merge commits show real changes
 * instead of an empty combined diff.
 */
export async function fileDiff(path: string, oid: string, file: string): Promise<string> {
  const dir = workdirOf(path);
  const base = await diffBase(dir, oid);
  return gitRead(dir, ['diff', base, oid, '--', file]);
}

function homeDir(): string {
  return process.env['USERPROFILE'] || process.env['HOME'] || '.';
}

/**
 * List the sub-directories of `path` for the folder picker. An empty `path`
 * starts at the user's home directory. Files are skipped; only folders show.
 */
export function listDir(path: string): DirListing {
  const start = path.trim() === '' ? homeDir() : path;

  let names: string[];
  try {
    names = readdirSync(start);
  } catch {
    throw new Error(`cannot read ${start}`);
  }

  const entries: DirEntry[] = [];
  for (const name of names) {
    // Skip hidden/system folders to keep the picker clean.
    if (name.startsWith('.') || name.startsWith('$')) continue;

    const full = join(start, name);
    // `statSync` follows symlinks, matching the Rust original — a symlinked
    // repo directory should still show up in the picker.
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    entries.push({ name, path: full, is_dir: true, is_repo: existsSync(join(full, '.git')) });
  }

  // Repos first, then alphabetical.
  entries.sort((a, b) => {
    if (a.is_repo !== b.is_repo) return a.is_repo ? -1 : 1;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });

  const parent = dirname(start);
  return { current: start, parent: parent === start ? null : parent, entries };
}

/** (ahead, behind, hasUpstream) for a working tree's HEAD vs its upstream. */
async function aheadBehind(wt: string): Promise<[number, number, boolean]> {
  try {
    const s = await gitRead(wt, ['rev-list', '--left-right', '--count', '@{u}...HEAD']);
    const parts = s.split(/\s+/).filter(Boolean);
    const behind = Number.parseInt(parts[0] ?? '', 10);
    const ahead = Number.parseInt(parts[1] ?? '', 10);
    return [Number.isNaN(ahead) ? 0 : ahead, Number.isNaN(behind) ? 0 : behind, true];
  } catch {
    return [0, 0, false];
  }
}

/**
 * List the repository's linked working trees with their state.
 * The per-worktree status/ahead-behind checks run concurrently, so wall time
 * is ~one check rather than 2×N sequential subprocesses.
 */
export async function worktrees(path: string): Promise<Worktree[]> {
  const dir = workdirOf(path);
  const metas = parseWorktreeList(await gitRead(dir, ['worktree', 'list', '--porcelain']));

  const checks = await Promise.all(
    metas.map(async (m) => {
      const dirty = await gitReadOr(m.path, ['status', '--porcelain'])
        .then((s) => s.trim().length > 0)
        .catch(() => false);
      return { dirty, ab: await aheadBehind(m.path) };
    }),
  );

  return metas.map((m, i) => {
    const c = checks[i]!;
    return {
      path: m.path,
      branch: m.branch,
      head: m.head,
      is_main: i === 0,
      detached: m.detached,
      dirty: c.dirty,
      ahead: c.ab[0],
      behind: c.ab[1],
      has_upstream: c.ab[2],
    };
  });
}

/**
 * Full SHAs of commits on local branches that are not on any remote
 * (i.e. unpushed). With no remotes configured, every local commit is listed.
 */
export async function unpushedCommits(path: string): Promise<string[]> {
  const dir = workdirOf(path);
  const out = await gitReadOr(dir, ['rev-list', '--branches', '--not', '--remotes']);
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** All tracked file paths, for the file finder. */
export async function listFiles(path: string): Promise<string[]> {
  const dir = workdirOf(path);
  const out = await gitRead(dir, ['ls-files']);
  return out.split('\n').filter((s) => s.length > 0);
}

/** Content search across tracked files (case-insensitive fixed-string). */
export async function grepRepo(path: string, query: string): Promise<GrepHit[]> {
  if (query.trim() === '') return [];
  const dir = workdirOf(path);
  // git grep exits non-zero on no matches, so treat errors as empty.
  const out = await gitReadOr(dir, ['grep', '-n', '-I', '-F', '-i', '-e', query]);

  const hits: GrepHit[] = [];
  for (const line of out.split('\n').slice(0, 300)) {
    const parts = splitN(line, ':', 3);
    const file = parts[0] ?? '';
    if (file === '') continue;
    const lno = Number.parseInt(parts[1] ?? '', 10);
    hits.push({ file, line: Number.isNaN(lno) ? 0 : lno, text: parts[2] ?? '' });
  }
  return hits;
}

/**
 * Every file path that has ever existed in the repo (current tracked files
 * plus any path touched anywhere in history), de-duplicated and sorted.
 */
export async function allFiles(path: string): Promise<string[]> {
  const dir = workdirOf(path);
  const set = new Set<string>();

  const tracked = await gitReadOr(dir, ['ls-files']);
  for (const l of tracked.split('\n')) if (l.length > 0) set.add(l);

  const historical = await gitReadOr(dir, ['log', '--all', '--pretty=format:', '--name-only']);
  for (const raw of historical.split('\n')) {
    const l = raw.trim();
    if (l.length > 0) set.add(l);
  }

  return [...set].sort();
}

/** Commits across all refs matching `query` by hash, message, or author. */
export async function searchCommits(path: string, query: string): Promise<CommitNode[]> {
  const q = query.trim();
  if (q === '') return [];

  const dir = workdirOf(path);
  const fmt = commitFormat();
  const seen = new Set<string>();
  const nodes: CommitNode[] = [];
  const take = (out: string) => {
    for (const c of parseCommitRecords(out)) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        nodes.push(c);
      }
    }
  };

  // 1. Hash lookup: a full or abbreviated SHA should jump straight to the
  //    commit. `--grep` never matches a commit's own id, so handle it first.
  const isHex = q.length >= 4 && q.length <= 40 && /^[0-9a-fA-F]+$/.test(q);
  if (isHex) {
    const oid = (
      await gitReadOr(dir, ['rev-parse', '--verify', '--quiet', `${q}^{commit}`])
    ).trim();
    if (oid !== '') {
      take(await gitReadOr(dir, ['log', '-n', '1', '--topo-order', fmt, oid]));
    }
  }

  // 2. Commit message match.
  take(await gitReadOr(dir, ['log', '--all', '-i', `--grep=${q}`, '-n', '40', '--topo-order', fmt]));

  // 3. Author name / email match.
  take(
    await gitReadOr(dir, ['log', '--all', '-i', `--author=${q}`, '-n', '20', '--topo-order', fmt]),
  );

  return nodes;
}

/** Commits that touched `file`, newest first. */
export async function fileHistory(path: string, file: string): Promise<CommitNode[]> {
  const dir = workdirOf(path);
  const out = await gitRead(dir, [
    'log',
    '--topo-order',
    '-n',
    '200',
    commitFormat(),
    '--follow',
    '--',
    file,
  ]);
  return parseCommitRecords(out);
}

/** Diff of a single file between two revisions. */
export function fileDiffBetween(
  path: string,
  a: string,
  b: string,
  file: string,
): Promise<string> {
  return gitRead(workdirOf(path), ['diff', a, b, '--', file]);
}

/** Contents of `file` at revision `rev` (e.g. "HEAD"), for quick view. */
export function fileAt(path: string, rev: string, file: string): Promise<string> {
  return gitRead(workdirOf(path), ['show', `${rev}:${file}`]);
}

/** Per-line blame for a file at HEAD. */
export async function blame(path: string, file: string): Promise<BlameLine[]> {
  const dir = workdirOf(path);
  const out = await gitRead(dir, ['blame', '--porcelain', 'HEAD', '--', file]);

  // Porcelain repeats full commit info only on a commit's first line, so we
  // cache (author, summary) per sha.
  const cache = new Map<string, [string, string]>();
  const lines: BlameLine[] = [];
  let sha = '';
  let author = '';
  let summary = '';
  let finalLine = 0;

  for (const raw of out.split('\n')) {
    if (raw.startsWith('\t')) {
      let entry = cache.get(sha);
      if (!entry) {
        entry = [author, summary];
        cache.set(sha, entry);
      }
      lines.push({
        line: finalLine,
        short: sha.slice(0, 7),
        author: entry[0],
        summary: entry[1],
        text: raw.slice(1),
      });
    } else if (raw.startsWith('author ')) {
      author = raw.slice('author '.length);
    } else if (raw.startsWith('summary ')) {
      summary = raw.slice('summary '.length);
      cache.set(sha, [author, summary]);
    } else if (isBlameHeader(raw)) {
      const it = raw.split(' ');
      sha = it[0] ?? '';
      const fl = Number.parseInt(it[2] ?? '', 10);
      finalLine = Number.isNaN(fl) ? 0 : fl;
      const hit = cache.get(sha);
      if (hit) {
        author = hit[0];
        summary = hit[1];
      }
    }
  }
  return lines;
}

/** Working-tree status: staged, unstaged, and untracked files. */
export async function workingStatus(path: string): Promise<WorkingStatus> {
  const dir = workdirOf(path);
  // `normal` collapses untracked directories to one entry instead of walking
  // them; on a repo with a fresh dependency dir that's the difference between
  // ~50ms and multiple seconds.
  const out = await gitRead(dir, ['status', '--porcelain', '--untracked-files=normal']);
  const groups = parsePorcelainStatus(out);
  return { ...groups, branch: await currentBranch(dir) };
}

/** Diff of one file in the working tree. `staged` selects the index diff. */
export function workingDiff(path: string, file: string, staged: boolean): Promise<string> {
  const dir = workdirOf(path);
  return staged
    ? gitRead(dir, ['diff', '--cached', '--', file])
    : gitRead(dir, ['diff', '--', file]);
}

/** Whether the working tree has any changes (for the sidebar dirty dot). */
export async function isDirty(path: string): Promise<boolean> {
  const out = await gitRead(workdirOf(path), ['status', '--porcelain']);
  return out.trim().length > 0;
}

/** The full staged diff (`git diff --cached`), for agent commit messages. */
export function stagedDiff(path: string): Promise<string> {
  return gitRead(workdirOf(path), ['diff', '--cached']);
}

/** Raw contents of a working-tree file (for previewing untracked files). */
export function workingFile(path: string, file: string): string {
  try {
    return readFileSync(join(workdirOf(path), file), 'utf8');
  } catch {
    return '';
  }
}
