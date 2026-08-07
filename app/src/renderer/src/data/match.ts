/**
 * File matching for Spotlight.
 *
 * Files are matched in the renderer rather than through git, because the list
 * of paths changes far less often than the query does: fetch it once per repo,
 * then every keystroke is pure comparison. Commits and content still go to git,
 * where the index lives — but those are debounced and these are not, which is
 * why typing feels instant even though two of the four groups are subprocesses.
 *
 * The index carries pre-lowered strings so matching allocates nothing per file
 * per keystroke. On a repo with 20k tracked paths that is the difference
 * between a responsive field and a stuttering one.
 */

export interface FileEntry {
  path: string;
  /** Lowercased full path. */
  lower: string;
  /** Lowercased basename. */
  base: string;
}

export function indexFiles(paths: readonly string[]): FileEntry[] {
  return paths.map((path) => {
    const lower = path.toLowerCase();
    const cut = lower.lastIndexOf('/');
    return { path, lower, base: cut === -1 ? lower : lower.slice(cut + 1) };
  });
}

/**
 * Is `q` a subsequence of `s`? This is the loosest tier — it lets "aptsx" find
 * "app/App.tsx" — so it scores below any contiguous match.
 */
function subsequence(s: string, q: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

/**
 * Higher is better; 0 means no match.
 *
 * The tiers are ordered by how confident we are the user meant this file. A
 * basename hit beats a path hit because people search for the file, not the
 * folder — "index" should not bury `src/index.ts` under
 * `src/index-helpers/thing.ts`.
 */
export function score(entry: FileEntry, q: string): number {
  if (q === '') return 0;

  if (entry.base === q) return 100;
  if (entry.base.startsWith(q)) return 90;
  if (entry.base.includes(q)) return 80;

  if (entry.lower.endsWith(q)) return 70;
  if (entry.lower.includes(q)) return 60;

  if (subsequence(entry.base, q)) return 40;
  if (subsequence(entry.lower, q)) return 20;

  return 0;
}

/**
 * Best `limit` matches, best first. Ties break on the shorter path, so a match
 * near the root outranks the same match buried deep — a deep file matched the
 * query by having more characters, not by being more relevant.
 */
export function matchFiles(
  index: readonly FileEntry[],
  query: string,
  limit = 8,
): FileEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const hits: { entry: FileEntry; s: number }[] = [];
  for (const entry of index) {
    const s = score(entry, q);
    if (s > 0) hits.push({ entry, s });
  }

  hits.sort((a, b) => b.s - a.s || a.entry.path.length - b.entry.path.length);
  return hits.slice(0, limit).map((h) => h.entry);
}

/** Case-insensitive substring filter for short lists (branches). */
export function matchStrings(
  values: readonly string[],
  query: string,
  limit = 5,
): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];
  return values.filter((v) => v.toLowerCase().includes(q)).slice(0, limit);
}
