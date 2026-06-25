//! Write paths and anything gix does not yet cover cleanly: we invoke the
//! user's installed `git` binary as a subprocess. This is the single boundary
//! where commit/stash/worktree/rebase operations will live.

use anyhow::{bail, Result};
use std::process::Command;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Don't pop a console window for each subprocess we spawn (Windows GUI apps
/// otherwise flash a console on every `git` call).
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// A `Command` that never flashes a console window on Windows.
pub fn command(program: &str) -> Command {
    let mut c = Command::new(program);
    #[cfg(windows)]
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

/// Run `git -C <workdir> <args...>` and return stdout on success.
pub fn git(workdir: &str, args: &[&str]) -> Result<String> {
    let out = command("git")
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

/// Stage one file (`git add`).
pub fn stage(path: &str, file: &str) -> Result<()> {
    let dir = super::read::workdir_of(path)?;
    git(&dir, &["add", "--", file])?;
    Ok(())
}

/// Unstage one file (`git restore --staged`).
pub fn unstage(path: &str, file: &str) -> Result<()> {
    let dir = super::read::workdir_of(path)?;
    git(&dir, &["restore", "--staged", "--", file])?;
    Ok(())
}

/// Stage everything (`git add -A`).
pub fn stage_all(path: &str) -> Result<()> {
    let dir = super::read::workdir_of(path)?;
    git(&dir, &["add", "-A"])?;
    Ok(())
}

/// Unstage everything (`git reset`).
pub fn unstage_all(path: &str) -> Result<()> {
    let dir = super::read::workdir_of(path)?;
    git(&dir, &["reset"])?;
    Ok(())
}

/// Commit the staged changes with `message`.
pub fn commit(path: &str, message: &str) -> Result<String> {
    let dir = super::read::workdir_of(path)?;
    git(&dir, &["commit", "-m", message])
}

/// Clone `url` into `dest` (a directory that must not already exist).
pub fn clone(url: &str, dest: &str) -> Result<()> {
    let out = command("git").args(["clone", url, dest]).output()?;
    if !out.status.success() {
        bail!(
            "git clone failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(())
}
