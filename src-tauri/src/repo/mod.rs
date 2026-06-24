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
