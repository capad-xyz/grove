//! Read paths. `gix` discovers and inspects the repository; the current branch
//! name is read through the `git` CLI to keep us off gix's faster-moving APIs
//! for now (a thin, easily-swapped boundary).

use super::write;
use super::{
    BlameLine, CommitDetail, CommitNode, DirEntry, DirListing, FileChange, GrepHit, RepoSummary,
    Worktree,
};
use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

// Field/record separators that cannot appear in commit metadata.
const FS: char = '\u{1f}';
const RS: char = '\u{1e}';

/// Resolve the directory to run `git -C` in for a repo at `path`.
fn workdir_of(path: &str) -> Result<String> {
    let repo = gix::discover(path).context("not a git repository")?;
    Ok(repo
        .workdir()
        .map(|p| p.display().to_string())
        .unwrap_or_else(|| repo.git_dir().display().to_string()))
}

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
            &commit_format(),
        ],
    )?;
    Ok(parse_commit_records(&out))
}

const fn commit_format_str() -> &'static str {
    "%H\u{1f}%h\u{1f}%P\u{1f}%an\u{1f}%at\u{1f}%D\u{1f}%s\u{1e}"
}
fn commit_format() -> String {
    format!("--pretty=format:{}", commit_format_str())
}

/// Parse `git log` output produced with `commit_format()` into commit nodes.
fn parse_commit_records(out: &str) -> Vec<CommitNode> {
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
        nodes.push(CommitNode {
            id: f[0].to_string(),
            short: f[1].to_string(),
            parents,
            author: f[3].to_string(),
            time: f[4].parse().unwrap_or(0),
            refs: parse_refs(f[5]),
            summary: f[6].to_string(),
        });
    }
    nodes
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

/// Metadata + changed-file list for one commit.
pub fn commit_detail(path: &str, oid: &str) -> Result<CommitDetail> {
    let dir = workdir_of(path)?;

    let meta = write::git(
        &dir,
        &[
            "show",
            "-s",
            &format!("--format=%H{FS}%h{FS}%an{FS}%ae{FS}%at{FS}%s{FS}%b"),
            oid,
        ],
    )?;
    let f: Vec<&str> = meta.trim_end_matches('\n').splitn(7, FS).collect();
    if f.len() < 6 {
        anyhow::bail!("unexpected commit metadata");
    }

    // status letter per path (best effort; renames keep the new path)
    let mut status: HashMap<String, String> = HashMap::new();
    let name_status = write::git(&dir, &["show", oid, "--format=", "--name-status"])?;
    for line in name_status.lines().filter(|l| !l.is_empty()) {
        let mut cols = line.split('\t');
        let code = cols.next().unwrap_or("M");
        if let Some(p) = cols.last() {
            status.insert(p.to_string(), code.chars().next().unwrap_or('M').to_string());
        }
    }

    let mut files = Vec::new();
    let numstat = write::git(&dir, &["show", oid, "--format=", "--numstat"])?;
    for line in numstat.lines().filter(|l| !l.is_empty()) {
        let mut cols = line.split('\t');
        let adds = cols.next().unwrap_or("0");
        let dels = cols.next().unwrap_or("0");
        let p = cols.next().unwrap_or("").to_string();
        if p.is_empty() {
            continue;
        }
        files.push(FileChange {
            status: status.get(&p).cloned().unwrap_or_else(|| "M".into()),
            additions: adds.parse().unwrap_or(0),
            deletions: dels.parse().unwrap_or(0),
            path: p,
        });
    }

    Ok(CommitDetail {
        id: f[0].to_string(),
        short: f[1].to_string(),
        author: f[2].to_string(),
        email: f[3].to_string(),
        date: f[4].parse().unwrap_or(0),
        subject: f[5].to_string(),
        body: f.get(6).map(|s| s.trim_end().to_string()).unwrap_or_default(),
        files,
    })
}

/// Unified diff for a single file in a commit.
pub fn file_diff(path: &str, oid: &str, file: &str) -> Result<String> {
    let dir = workdir_of(path)?;
    write::git(&dir, &["show", oid, "--format=", "--", file])
}

/// List the sub-directories of `path` for the folder picker. An empty `path`
/// starts at the user's home directory. Files are skipped; only folders show.
pub fn list_dir(path: &str) -> Result<DirListing> {
    let start = if path.trim().is_empty() {
        dirs_home()
    } else {
        path.to_string()
    };
    let p = Path::new(&start);
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(p).with_context(|| format!("cannot read {start}"))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let meta = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };
        if !meta.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden/system folders to keep the picker clean.
        if name.starts_with('.') || name.starts_with('$') {
            continue;
        }
        let full = entry.path();
        let is_repo = full.join(".git").exists();
        entries.push(DirEntry {
            name,
            path: full.display().to_string(),
            is_dir: true,
            is_repo,
        });
    }
    // Repos first, then alphabetical.
    entries.sort_by(|a, b| {
        b.is_repo
            .cmp(&a.is_repo)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(DirListing {
        current: p.display().to_string(),
        parent: p.parent().map(|p| p.display().to_string()),
        entries,
    })
}

fn dirs_home() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".into())
}

/// List the repository's linked working trees with their state.
pub fn worktrees(path: &str) -> Result<Vec<Worktree>> {
    let dir = workdir_of(path)?;
    let out = write::git(&dir, &["worktree", "list", "--porcelain"])?;
    let normalized = out.replace('\r', "");
    let mut list = Vec::new();

    for (i, block) in normalized.split("\n\n").enumerate() {
        let block = block.trim();
        if block.is_empty() {
            continue;
        }
        let mut wt_path = String::new();
        let mut head = String::new();
        let mut branch = None;
        let mut detached = false;
        for line in block.lines() {
            if let Some(p) = line.strip_prefix("worktree ") {
                wt_path = p.to_string();
            } else if let Some(h) = line.strip_prefix("HEAD ") {
                head = h.chars().take(7).collect();
            } else if let Some(b) = line.strip_prefix("branch ") {
                branch = Some(b.trim_start_matches("refs/heads/").to_string());
            } else if line.trim() == "detached" {
                detached = true;
            }
        }
        if wt_path.is_empty() {
            continue;
        }
        let dirty = write::git(&wt_path, &["status", "--porcelain"])
            .map(|s| !s.trim().is_empty())
            .unwrap_or(false);
        let (ahead, behind, has_upstream) = ahead_behind(&wt_path);
        list.push(Worktree {
            is_main: i == 0,
            path: wt_path,
            branch,
            head,
            detached,
            dirty,
            ahead,
            behind,
            has_upstream,
        });
    }
    Ok(list)
}

/// (ahead, behind, has_upstream) for the working tree's HEAD vs its upstream.
fn ahead_behind(wt: &str) -> (u32, u32, bool) {
    match write::git(wt, &["rev-list", "--left-right", "--count", "@{u}...HEAD"]) {
        Ok(s) => {
            let mut it = s.split_whitespace();
            let behind = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            let ahead = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            (ahead, behind, true)
        }
        Err(_) => (0, 0, false),
    }
}

/// Full SHAs of commits on local branches that are not on any remote
/// (i.e. unpushed). With no remotes configured, every local commit is listed.
pub fn unpushed_commits(path: &str) -> Result<Vec<String>> {
    let dir = workdir_of(path)?;
    let out = write::git(&dir, &["rev-list", "--branches", "--not", "--remotes"]).unwrap_or_default();
    Ok(out
        .lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

/// All tracked file paths, for the file finder.
pub fn list_files(path: &str) -> Result<Vec<String>> {
    let dir = workdir_of(path)?;
    let out = write::git(&dir, &["ls-files"])?;
    Ok(out
        .lines()
        .map(|s| s.to_string())
        .filter(|s| !s.is_empty())
        .collect())
}

/// Content search across tracked files (case-insensitive fixed-string).
pub fn grep_repo(path: &str, query: &str) -> Result<Vec<GrepHit>> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    let dir = workdir_of(path)?;
    // git grep exits non-zero on no matches, so treat errors as empty.
    let out = write::git(&dir, &["grep", "-n", "-I", "-F", "-i", "-e", query]).unwrap_or_default();
    let mut hits = Vec::new();
    for line in out.lines().take(300) {
        let mut parts = line.splitn(3, ':');
        let file = parts.next().unwrap_or("").to_string();
        let lno = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
        let text = parts.next().unwrap_or("").to_string();
        if file.is_empty() {
            continue;
        }
        hits.push(GrepHit { file, line: lno, text });
    }
    Ok(hits)
}

/// Commits that touched `file`, newest first.
pub fn file_history(path: &str, file: &str) -> Result<Vec<CommitNode>> {
    let dir = workdir_of(path)?;
    let out = write::git(
        &dir,
        &[
            "log",
            "--topo-order",
            "-n",
            "200",
            &commit_format(),
            "--follow",
            "--",
            file,
        ],
    )?;
    Ok(parse_commit_records(&out))
}

/// Diff of a single file between two revisions.
pub fn file_diff_between(path: &str, a: &str, b: &str, file: &str) -> Result<String> {
    let dir = workdir_of(path)?;
    write::git(&dir, &["diff", a, b, "--", file])
}

/// Contents of `file` at revision `rev` (e.g. "HEAD"), for quick view.
pub fn file_at(path: &str, rev: &str, file: &str) -> Result<String> {
    let dir = workdir_of(path)?;
    write::git(&dir, &["show", &format!("{rev}:{file}")])
}

/// Per-line blame for a file at HEAD.
pub fn blame(path: &str, file: &str) -> Result<Vec<BlameLine>> {
    let dir = workdir_of(path)?;
    let out = write::git(&dir, &["blame", "--porcelain", "HEAD", "--", file])?;

    // Porcelain repeats full commit info only on a commit's first line, so we
    // cache (author, summary) per sha.
    let mut cache: HashMap<String, (String, String)> = HashMap::new();
    let mut lines = Vec::new();
    let mut sha = String::new();
    let mut author = String::new();
    let mut summary = String::new();
    let mut final_line = 0u32;

    for raw in out.split('\n') {
        if let Some(code) = raw.strip_prefix('\t') {
            let (a, s) = cache
                .entry(sha.clone())
                .or_insert((author.clone(), summary.clone()));
            lines.push(BlameLine {
                line: final_line,
                short: sha.chars().take(7).collect(),
                author: a.clone(),
                summary: s.clone(),
                text: code.to_string(),
            });
        } else if let Some(rest) = raw.strip_prefix("author ") {
            author = rest.to_string();
        } else if let Some(rest) = raw.strip_prefix("summary ") {
            summary = rest.to_string();
            cache.insert(sha.clone(), (author.clone(), summary.clone()));
        } else if is_blame_header(raw) {
            let mut it = raw.split(' ');
            sha = it.next().unwrap_or("").to_string();
            let _orig = it.next();
            final_line = it.next().and_then(|x| x.parse().ok()).unwrap_or(0);
            if let Some((a, s)) = cache.get(&sha) {
                author = a.clone();
                summary = s.clone();
            }
        }
    }
    Ok(lines)
}

/// A porcelain blame header is "<40-hex-sha> <orig> <final> [<count>]".
fn is_blame_header(l: &str) -> bool {
    let b = l.as_bytes();
    b.len() > 40 && b[40] == b' ' && b[..40].iter().all(|c| c.is_ascii_hexdigit())
}
