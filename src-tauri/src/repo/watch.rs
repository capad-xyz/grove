//! File watcher: classifies filesystem events into repo-state invalidations
//! and feeds them to the repo service. The old watcher only *filtered* noise
//! and then refreshed everything; classifying instead means a ref update only
//! recomputes the graph, a workdir save only recomputes status, and — unlike
//! before — `.git/index` changes are *seen*, which is exactly the signal that
//! an agent staged files.

use super::service::{RepoService, INV_INDEX, INV_REFS, INV_WORKDIR, INV_WORKTREES};
use anyhow::Result;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use std::sync::Arc;

/// Map one event path to invalidation bits (0 = noise, ignore).
fn classify(path: &str) -> u8 {
    let s = path.replace('\\', "/");
    if s.ends_with("/.git") {
        return 0;
    }
    if let Some(i) = s.find("/.git/") {
        let g = &s[i + 6..];
        if g.ends_with(".lock") {
            return 0; // index.lock et al: transient, never a state change
        }
        if g == "index" {
            return INV_INDEX;
        }
        if g == "HEAD" || g == "packed-refs" || g.starts_with("refs/") {
            return INV_REFS;
        }
        if g.starts_with("worktrees/") {
            return INV_WORKTREES;
        }
        // objects/, logs/, FETCH_HEAD, COMMIT_EDITMSG, ORIG_HEAD, config, ...
        // are internal churn; the states they imply always surface via refs
        // or the index as well.
        return 0;
    }
    // Working-tree path. `notify` does not honour .gitignore, so drop the
    // high-volume build/dependency dirs that would otherwise flood us.
    if s.contains("/node_modules/")
        || s.contains("/target/")
        || s.contains("/dist/")
        || s.contains("/build/")
        || s.contains("/.svelte-kit/")
        || s.contains("/.next/")
    {
        return 0;
    }
    INV_WORKDIR
}

/// Watch `root` recursively, poking `svc` with classified invalidations.
/// Dropping the returned watcher stops it.
pub fn start_watcher(svc: Arc<RepoService>, root: &str) -> Result<RecommendedWatcher> {
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(event) = res {
            let mut bits = 0u8;
            for p in &event.paths {
                bits |= classify(&p.to_string_lossy());
            }
            if bits != 0 {
                svc.poke(bits);
            }
        }
    })?;
    watcher.watch(std::path::Path::new(root), RecursiveMode::Recursive)?;
    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_git_internals() {
        assert_eq!(classify(r"C:\r\.git\index"), INV_INDEX);
        assert_eq!(classify(r"C:\r\.git\index.lock"), 0);
        assert_eq!(classify(r"C:\r\.git\HEAD"), INV_REFS);
        assert_eq!(classify(r"C:\r\.git\refs\heads\main"), INV_REFS);
        assert_eq!(classify(r"C:\r\.git\packed-refs"), INV_REFS);
        assert_eq!(classify(r"C:\r\.git\worktrees\wt1\HEAD"), INV_WORKTREES);
        assert_eq!(classify(r"C:\r\.git\objects\ab\cdef"), 0);
        assert_eq!(classify(r"C:\r\.git\COMMIT_EDITMSG"), 0);
        assert_eq!(classify(r"C:\r\.git"), 0);
    }

    #[test]
    fn classifies_workdir() {
        assert_eq!(classify(r"C:\r\src\main.rs"), INV_WORKDIR);
        assert_eq!(classify(r"C:\r\Cargo.lock"), INV_WORKDIR);
        assert_eq!(classify(r"C:\r\node_modules\x\y.js"), 0);
        assert_eq!(classify(r"C:\r\target\debug\foo"), 0);
        assert_eq!(classify(r"C:\r\dist\bundle.js"), 0);
    }
}
