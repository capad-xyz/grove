//! Write paths and anything gix does not yet cover cleanly: we invoke the
//! user's installed `git` binary as a subprocess. This is the single boundary
//! where commit/stash/worktree/rebase operations will live.

use anyhow::{bail, Result};
use std::process::Command;

/// Run `git -C <workdir> <args...>` and return stdout on success.
pub fn git(workdir: &str, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(workdir)
        .args(args)
        .output()?;

    if !out.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }

    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Clone `url` into `dest` (a directory that must not already exist).
pub fn clone(url: &str, dest: &str) -> Result<()> {
    let out = Command::new("git").args(["clone", url, dest]).output()?;
    if !out.status.success() {
        bail!(
            "git clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}
