/**
 * Find-in-diff.
 *
 * Kept pure and separate from the component: the interesting part is the
 * matching, and matching is the part that is easy to get subtly wrong —
 * overlapping hits, zero-length queries, regex characters typed into what is
 * meant to be a literal search.
 *
 * Matching is literal and case-insensitive. A diff is code, and code is full of
 * `(`, `[`, `.` and `*`; treating the query as a pattern would surprise
 * everyone and help nobody.
 */

export interface Match {
  /** Index into the lines array. */
  line: number;
  /** Character offsets within that line. */
  start: number;
  end: number;
}

/** Every occurrence of `query`, in document order. */
export function findMatches(lines: readonly string[], query: string): Match[] {
  const q = query.toLowerCase();
  if (q === '') return [];

  const out: Match[] = [];
  for (let line = 0; line < lines.length; line++) {
    const hay = lines[line]!.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(q, from);
      if (at === -1) break;
      out.push({ line, start: at, end: at + q.length });
      // Advance past this hit so "aa" in "aaaa" yields two matches, not three.
      // Overlapping hits would make the count disagree with what is visible.
      from = at + q.length;
    }
  }
  return out;
}

export interface Segment {
  text: string;
  hit: boolean;
  /** Index into the full match list, for marking the current one. */
  index: number;
}

/**
 * Split one line into plain and matched runs, ready to render.
 *
 * Returns a single unmatched segment when there is nothing to highlight, so
 * the common case allocates almost nothing — a diff is mostly lines that do
 * not match.
 */
export function segments(
  text: string,
  matches: readonly Match[],
  line: number,
  firstIndexOnLine: number,
): Segment[] {
  const mine = matches.filter((m) => m.line === line);
  if (mine.length === 0) return [{ text, hit: false, index: -1 }];

  const out: Segment[] = [];
  let at = 0;
  mine.forEach((m, i) => {
    if (m.start > at) out.push({ text: text.slice(at, m.start), hit: false, index: -1 });
    out.push({ text: text.slice(m.start, m.end), hit: true, index: firstIndexOnLine + i });
    at = m.end;
  });
  if (at < text.length) out.push({ text: text.slice(at), hit: false, index: -1 });
  return out;
}

/** Wrap around in both directions, so cycling never dead-ends. */
export function step(current: number, total: number, delta: number): number {
  if (total === 0) return 0;
  return (current + delta + total) % total;
}
