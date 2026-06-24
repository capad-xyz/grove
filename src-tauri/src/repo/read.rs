//! Read paths. `gix` discovers and inspects the repository; the current branch
//! name is read through the `git` CLI to keep us off gix's faster-moving APIs
//! for now (a thin, easily-swapped boundary).

use super::RepoSummary;
use super::write;
use anyhow::{Context, Result};

/// Discover a git repository at (or above) `path` and summarize it.
pub fn open(path: &str) -> Result<RepoSummary> {
    let repo = gix::discover(path).context("not a git repository")?;

    let git_dir = repo.git_dir().display().to_string();
    let workdir = repo.work_dir().map(|p| p.display().to_string());
    let is_bare = repo.work_dir().is_none();

    let head = workdir.as_deref().and_then(current_branch);

    Ok(RepoSummary {
        path: git_dir,
        workdir,
        is_bare,
        head,
    })
}

/// Short branch name for the working tree, or `None` if detached/unknown.
fn current_branch(workdir: &str) -> Option<String> {
    let out = write::git(workdir, &["rev-parse", "--abbrev-ref", "HEAD"]).ok()?;
    let name = out.trim();
    match name {
        "" | "HEAD" => None,
        _ => Some(name.to_string()),
    }
}
