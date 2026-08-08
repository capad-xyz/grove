/**
 * "Since you last looked" — the arithmetic behind Grove's whole reason to exist.
 *
 * "Last looked" means the last time the window had focus, not the last time it
 * was open. That is the literal reading of the phrase and the useful one: you
 * turn to your editor, an agent works, you turn back, and the question is what
 * happened in the gap. So the mark is written on blur (everything on screen
 * when you looked away is, by definition, seen) and read on focus.
 *
 * The measurement is kept pure and separate from React so it can be tested
 * without a DOM — it only runs on a window-focus transition, which is
 * effectively impossible to exercise from the browser harness.
 */

import type { CommitNode, WorkingStatus } from '@grove/engine';

export interface SeenMark {
  /** Newest commit id the user has actually looked at. */
  sha: string | null;
  /** Working-tree entry count (staged + unstaged + untracked) at that moment. */
  files: number;
}

/** What arrived while the window was not focused. */
export interface Away {
  commits: number;
  files: number;
}

export const fileCount = (s: WorkingStatus | null): number =>
  s ? s.staged.length + s.unstaged.length + s.untracked.length : 0;

/**
 * Commits newer than the mark, plus the growth in working-tree entries.
 *
 * Only *growth* is reported for files: a count that fell usually means work was
 * committed, which the commit number already covers, and reporting it as
 * "changed" would double-count the same event.
 */
export function measureAway(
  mark: SeenMark | null,
  log: readonly CommitNode[],
  status: WorkingStatus | null,
): Away {
  // No mark means this is the first look. Flagging all of history as unseen
  // would be technically true and completely useless.
  if (!mark) return { commits: 0, files: 0 };

  const idx = mark.sha === null ? -1 : log.findIndex((c) => c.id === mark.sha);

  const commits =
    mark.sha === null
      ? 0
      : idx === -1
        ? // The mark is set but its commit is gone: history was rewritten
          // (rebase, amend) or it fell past the fetch window. Treating
          // everything loaded as new is the safe reading — better to over-report
          // than to silently hide work.
          log.length
        : idx;

  return { commits, files: Math.max(0, fileCount(status) - mark.files) };
}

export const isAway = (a: Away): boolean => a.commits > 0 || a.files > 0;

/**
 * Persisted per repo, in localStorage rather than component state, so closing
 * the window and coming back tomorrow still answers correctly.
 */
const SEEN_KEY = 'grove:last-seen';

export function lastSeen(repo: string): SeenMark | null {
  try {
    const mark = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}')[repo];
    return mark && typeof mark === 'object' ? (mark as SeenMark) : null;
  } catch {
    return null;
  }
}

export function markSeen(repo: string, mark: SeenMark): void {
  try {
    const all = JSON.parse(localStorage.getItem(SEEN_KEY) ?? '{}');
    all[repo] = mark;
    localStorage.setItem(SEEN_KEY, JSON.stringify(all));
  } catch {
    // A browser with storage disabled just loses the marker; not fatal.
  }
}
