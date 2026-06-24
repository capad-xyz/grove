//! Read paths. `gix` discovers and inspects the repository; the current branch
//! name is read through the `git` CLI to keep us off gix's faster-moving APIs
//! for now (a thin, easily-swapped boundary).

use super::write;
use super::{CommitNode, RepoSummary};
use anyhow::{Context, Result};

// Field/record separators that cannot appear in commit metadata.
const FS: char = '\u{1f}';
const RS: char = '\u{1e}';

/// Discover a git repository at (or above) `path` and summarize it.
pub fn open(path: &str) -> Result<RepoSummary> {
    let repo = gix::discover(path).context("not a git repository")?;

    let git_dir = repo.git_dir().display().to_string();
    let workdir = repo.workdir().map(|p| p.display().to_string());
    let is_bare = repo.workdir().is_none();

    let head = workdir.as_deref().and_then(current_branch);

    Ok(RepoSummary {
        path: git_dir,
        workdir,
        is_bare,
        head,
    })
}

/// Walk the commit graph across all refs, newest first, capped at `limit`.
/// Returned in topological order so the frontend can assign lanes in one pass.
pub fn graph(path: &str, limit: u32) -> Result<Vec<CommitNode>> {
    // Resolve to the working dir (or git dir for bare) so `git -C` works.
    let repo = gix::discover(path).context("not a git repository")?;
    let dir = repo
        .workdir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| repo.git_dir().display().to_string());

    let fmt = format!("--pretty=format:%H{FS}%h{FS}%P{FS}%an{FS}%at{FS}%D{FS}%s{RS}");
    let limit = limit.to_string();
    let out = write::git(
        &dir,
        &[
            "log",
            "--all",
            "--topo-order",
            "--decorate=full",
            "-n",
            &limit,
            &fmt,
        ],
    )?;

    let mut nodes = Vec::new();
    for record in out.split(RS) {
        let record = record.trim_start_matches('\n');
        if record.is_empty() {
            continue;
        }
        let f: Vec<&str> = record.split(FS).collect();
        if f.len() < 7 {
            continue;
        }
        let parents = f[2]
            .split_whitespace()
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        let refs = parse_refs(f[5]);
        nodes.push(CommitNode {
            id: f[0].to_string(),
            short: f[1].to_string(),
            parents,
            author: f[3].to_string(),
            time: f[4].parse().unwrap_or(0),
            refs,
            summary: f[6].to_string(),
        });
    }
    Ok(nodes)
}

/// Turn `%D` decorations into clean short names, e.g.
/// "HEAD -> refs/heads/main, tag: refs/tags/v1" => ["HEAD", "main", "v1"].
fn parse_refs(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.trim_start_matches("HEAD -> ")
                .trim_start_matches("tag: ")
                .trim_start_matches("refs/heads/")
                .trim_start_matches("refs/remotes/")
                .trim_start_matches("refs/tags/")
                .to_string()
        })
        .collect()
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
