//! Repository access, split by operation type (see DESIGN.md section 2):
//! - `read`  : fast read paths via gix (graph, log, blame, status, worktrees)
//! - `write` : mutations shell out to the user's `git` binary

pub mod read;
pub mod write;

use serde::{Deserialize, Serialize};

/// A minimal snapshot returned when a repo is first opened.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RepoSummary {
    /// Absolute path to the `.git` directory.
    pub path: String,
    /// Working tree path, or `None` for a bare repo.
    pub workdir: Option<String>,
    pub is_bare: bool,
    /// Short name of the current branch, or `None` if detached.
    pub head: Option<String>,
}

/// One commit in the graph. Lane layout is computed on the frontend from the
/// parent links.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommitNode {
    pub id: String,
    pub short: String,
    pub parents: Vec<String>,
    pub author: String,
    /// Author timestamp, epoch seconds.
    pub time: i64,
    /// Decorations on this commit (branch/tag/HEAD names), cleaned up.
    pub refs: Vec<String>,
    pub summary: String,
}

/// One file changed by a commit.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileChange {
    pub path: String,
    /// Single-letter status: A, M, D, R, C, ... (best effort).
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

/// Full detail for one commit, shown in the side panel.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CommitDetail {
    pub id: String,
    pub short: String,
    pub author: String,
    pub email: String,
    pub date: i64,
    pub subject: String,
    pub body: String,
    pub files: Vec<FileChange>,
}

/// A directory entry shown in the folder picker.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// True if this directory is itself a git repository.
    pub is_repo: bool,
}

/// One level of the folder picker.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct DirListing {
    pub current: String,
    pub parent: Option<String>,
    pub entries: Vec<DirEntry>,
}

/// One linked working tree of a repository.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Worktree {
    pub path: String,
    pub branch: Option<String>,
    pub head: String,
    pub is_main: bool,
    pub detached: bool,
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub has_upstream: bool,
}
