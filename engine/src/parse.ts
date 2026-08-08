/**
 * Pure parsers for git's output.
 *
 * Kept separate from the functions that spawn git so they can be tested
 * without a repository on disk — these are where the porting bugs live.
 */

import type { CommitNode } from './types.ts';

/**
 * Field/record separators that cannot appear in commit metadata.
 * Built with `fromCharCode` rather than written literally: these are invisible
 * control characters, and an editor normalising them on save would silently
 * break every commit parse.
 */
export const FS = String.fromCharCode(0x1f);
export const RS = String.fromCharCode(0x1e);

export const COMMIT_FORMAT_STR = `%H${FS}%h${FS}%P${FS}%an${FS}%at${FS}%D${FS}%s${RS}`;
export const commitFormat = () => `--pretty=format:${COMMIT_FORMAT_STR}`;

/**
 * Split into at most `n` pieces, with the final piece holding the remainder.
 *
 * `String.prototype.split(sep, limit)` *discards* everything past the limit;
 * Rust's `splitn` keeps it in the last field. Commit bodies are read out of
 * that trailing field, so using the built-in here would silently truncate
 * every multi-paragraph commit message.
 */
export function splitN(s: string, sep: string, n: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (out.length < n - 1) {
    const i = rest.indexOf(sep);
    if (i === -1) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

/** Rust's `trim_start_matches`: strip *every* leading repetition of `prefix`. */
export function stripPrefixRepeated(s: string, prefix: string): string {
  let out = s;
  while (prefix && out.startsWith(prefix)) out = out.slice(prefix.length);
  return out;
}

/** Rust's `trim_end_matches` for a single char. */
export function trimEndChars(s: string, ch: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ch) end--;
  return s.slice(0, end);
}

/**
 * Turn `%D` decorations into clean short names, e.g.
 * "HEAD -> refs/heads/main, tag: refs/tags/v1" => ["HEAD", "main", "v1"].
 */
export function parseRefs(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      let r = stripPrefixRepeated(s, 'HEAD -> ');
      r = stripPrefixRepeated(r, 'tag: ');
      r = stripPrefixRepeated(r, 'refs/heads/');
      r = stripPrefixRepeated(r, 'refs/remotes/');
      r = stripPrefixRepeated(r, 'refs/tags/');
      return r;
    });
}

/** Parse `git log` output produced with `commitFormat()` into commit nodes. */
export function parseCommitRecords(out: string): CommitNode[] {
  const nodes: CommitNode[] = [];
  for (const rawRecord of out.split(RS)) {
    const record = stripPrefixRepeated(rawRecord, '\n');
    if (record.length === 0) continue;

    const f = record.split(FS);
    if (f.length < 7) continue;

    const time = Number.parseInt(f[4]!, 10);
    nodes.push({
      id: f[0]!,
      short: f[1]!,
      parents: f[2]!.split(/\s+/).filter((s) => s.length > 0),
      author: f[3]!,
      time: Number.isNaN(time) ? 0 : time,
      refs: parseRefs(f[5]!),
      summary: f[6]!,
    });
  }
  return nodes;
}

/** A porcelain blame header is "<40-hex-sha> <orig> <final> [<count>]". */
export function isBlameHeader(l: string): boolean {
  if (l.length <= 40 || l[40] !== ' ') return false;
  for (let i = 0; i < 40; i++) {
    const c = l.charCodeAt(i);
    // 0-9, a-f, A-F
    const hex = (c >= 48 && c <= 57) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
    if (!hex) return false;
  }
  return true;
}

/** One block of `git worktree list --porcelain`, before state is filled in. */
export interface WorktreeMeta {
  path: string;
  head: string;
  branch: string | null;
  detached: boolean;
}

export function parseWorktreeList(out: string): WorktreeMeta[] {
  const metas: WorktreeMeta[] = [];
  for (const rawBlock of out.replace(/\r/g, '').split('\n\n')) {
    const block = rawBlock.trim();
    if (!block) continue;

    const m: WorktreeMeta = { path: '', head: '', branch: null, detached: false };
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) m.path = line.slice('worktree '.length);
      else if (line.startsWith('HEAD ')) m.head = line.slice('HEAD '.length).slice(0, 7);
      else if (line.startsWith('branch '))
        m.branch = stripPrefixRepeated(line.slice('branch '.length), 'refs/heads/');
      else if (line.trim() === 'detached') m.detached = true;
    }
    if (m.path) metas.push(m);
  }
  return metas;
}

/**
 * Parse the combined `git diff --raw --numstat` output used by `commitDetail`.
 *
 * One subprocess emits both blocks: the raw block (":… M\tpath") comes first,
 * so statuses are known before the numstat rows ("adds\tdels\tpath") are read.
 */
export function parseRawNumstat(changes: string): {
  path: string;
  status: string;
  additions: number;
  deletions: number;
}[] {
  const status = new Map<string, string>();
  const files: { path: string; status: string; additions: number; deletions: number }[] = [];

  for (const line of changes.split('\n')) {
    if (!line) continue;

    if (line.startsWith(':')) {
      // ":100644 100644 sha sha M\tpath" (renames keep the new path).
      const head = line.split('\t')[0] ?? '';
      const parts = head.split(' ');
      const code = parts[parts.length - 1] || 'M';
      const cols = line.split('\t');
      const p = cols[cols.length - 1];
      if (p) status.set(p, (code[0] ?? 'M').toString());
      continue;
    }

    const cols = line.split('\t');
    const adds = Number.parseInt(cols[0] ?? '0', 10);
    const dels = Number.parseInt(cols[1] ?? '0', 10);
    const p = cols[2] ?? '';
    if (!p) continue;

    files.push({
      path: p,
      status: status.get(p) ?? 'M',
      additions: Number.isNaN(adds) ? 0 : adds,
      deletions: Number.isNaN(dels) ? 0 : dels,
    });
  }
  return files;
}

/** Parse `git status --porcelain` into staged / unstaged / untracked groups. */
export function parsePorcelainStatus(out: string): {
  staged: { path: string; status: string }[];
  unstaged: { path: string; status: string }[];
  untracked: string[];
} {
  const staged: { path: string; status: string }[] = [];
  const unstaged: { path: string; status: string }[] = [];
  const untracked: string[] = [];

  for (const line of out.split('\n')) {
    if (line.length < 3) continue;
    const x = line[0]!;
    const y = line[1]!;
    const rest = line.slice(3);
    // Renames are "old -> new"; the new path is what we act on.
    const idx = rest.lastIndexOf(' -> ');
    const p = idx === -1 ? rest : rest.slice(idx + ' -> '.length);

    if (x === '?' && y === '?') {
      untracked.push(p);
      continue;
    }
    if (x !== ' ') staged.push({ path: p, status: x });
    if (y !== ' ') unstaged.push({ path: p, status: y });
  }
  return { staged, unstaged, untracked };
}
