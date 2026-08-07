/**
 * The wire types shared by the engine and whatever renders it.
 *
 * These are a direct port of the serde structs in `src-tauri/src/repo/mod.rs`
 * and the `RepoEvent` enum in `src-tauri/src/repo/service.rs`. Field names and
 * event tags match the Rust payloads byte for byte, so both engines can be run
 * against the same frontend while the migration is in flight.
 */

/** A minimal snapshot returned when a repo is first opened. */
export interface RepoSummary {
  /** Absolute path to the `.git` directory. */
  path: string;
  /** Working tree path, or `null` for a bare repo. */
  workdir: string | null;
  is_bare: boolean;
  /** Short name of the current branch, or `null` if detached. */
  head: string | null;
}

/**
 * One commit in the graph. Lane layout is computed on the frontend from the
 * parent links.
 */
export interface CommitNode {
  id: string;
  short: string;
  parents: string[];
  author: string;
  /** Author timestamp, epoch seconds. */
  time: number;
  /** Decorations on this commit (branch/tag/HEAD names), cleaned up. */
  refs: string[];
  summary: string;
}

/** One file changed by a commit. */
export interface FileChange {
  path: string;
  /** Single-letter status: A, M, D, R, C, ... (best effort). */
  status: string;
  additions: number;
  deletions: number;
}

/** Full detail for one commit, shown in the side panel. */
export interface CommitDetail {
  id: string;
  short: string;
  author: string;
  email: string;
  date: number;
  subject: string;
  body: string;
  files: FileChange[];
}

/** A directory entry shown in the folder picker. */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  /** True if this directory is itself a git repository. */
  is_repo: boolean;
}

/** One level of the folder picker. */
export interface DirListing {
  current: string;
  parent: string | null;
  entries: DirEntry[];
}

/** One changed file in the working tree (staged or unstaged group). */
export interface FileStatus {
  path: string;
  status: string;
}

/** The working-tree state: staged, unstaged, and untracked files. */
export interface WorkingStatus {
  staged: FileStatus[];
  unstaged: FileStatus[];
  untracked: string[];
  branch: string | null;
}

/** One line of `git blame` output. */
export interface BlameLine {
  line: number;
  short: string;
  author: string;
  summary: string;
  text: string;
}

/** One match from a repository content search. */
export interface GrepHit {
  file: string;
  line: number;
  text: string;
}

/** One linked working tree of a repository. */
export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  is_main: boolean;
  detached: boolean;
  dirty: boolean;
  ahead: number;
  behind: number;
  has_upstream: boolean;
}

/** A repository the user has opened before, persisted between sessions. */
export interface RecentRepo {
  path: string;
  name: string;
}

// --- Refresh events -------------------------------------------------------

/**
 * Invalidation bits: which parts of repo state a change may have touched.
 * Ported from `service.rs`; the watcher produces these and the coordinator
 * consumes them.
 */
export const INV_REFS = 1 << 0; // .git/refs, HEAD, packed-refs → graph, branches, unpushed
export const INV_INDEX = 1 << 1; // .git/index → staged status (agents staging files)
export const INV_WORKDIR = 1 << 2; // working-tree file edits → status, dirty
export const INV_WORKTREES = 1 << 3; // .git/worktrees metadata
export const INV_FULL = INV_REFS | INV_INDEX | INV_WORKDIR | INV_WORKTREES;

/**
 * Typed refresh payloads. Every payload carries a generation number so a
 * consumer can drop anything stale, and a `root` so it can discard events
 * belonging to a previously open repo.
 */
export type RepoEvent =
  | {
      kind: 'graph_changed';
      gen: number;
      head: string | null;
      commits: CommitNode[];
      unpushed: string[];
    }
  | { kind: 'status_changed'; gen: number; status: WorkingStatus; dirty: boolean }
  | { kind: 'worktrees_changed'; gen: number; worktrees: Worktree[] }
  | { kind: 'branches_changed'; gen: number; branches: string[] }
  | { kind: 'refresh_error'; gen: number; op: string; message: string };

/** A `RepoEvent` tagged with the repo it came from. */
export type RepoEventEnvelope = RepoEvent & { root: string };
