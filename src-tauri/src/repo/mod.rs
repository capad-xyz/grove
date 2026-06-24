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
