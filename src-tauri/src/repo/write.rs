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

/// Backoff schedule for retrying a git command that lost the race for the
/// index lock (an agent committing while the user stages, or vice versa).
const LOCK_RETRY_MS: &[u64] = &[100, 300, 800, 1500];

/// Does this stderr indicate transient lock contention (safe to retry)?
/// We never delete the lock file ourselves — the other process owns it.
fn is_lock_error(stderr: &str) -> bool {
    let m = stderr.to_lowercase();
    m.contains("index.lock")
        || m.contains("another git process")
        || (m.contains("unable to create") && m.contains(".lock"))
}

fn run_git(workdir: &str, extra: &[&str], args: &[&str]) -> Result<String> {
    let out = command("git")
        .arg("-C")
        .arg(workdir)
        .args(extra)
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

fn git_with_retry(workdir: &str, extra: &[&str], args: &[&str]) -> Result<String> {
    let mut attempt = 0;
    loop {
        match run_git(workdir, extra, args) {
            Ok(out) => return Ok(out),
            Err(e) if attempt < LOCK_RETRY_MS.len() && is_lock_error(&e.to_string()) => {
                std::thread::sleep(std::time::Duration::from_millis(LOCK_RETRY_MS[attempt]));
                attempt += 1;
            }
            Err(e) => return Err(e),
        }
    }
}

/// Run `git -C <workdir> <args...>` and return stdout on success.
/// Retries briefly on index-lock contention.
pub fn git(workdir: &str, args: &[&str]) -> Result<String> {
    git_with_retry(workdir, &[], args)
}

/// Read-path variant: `--no-optional-locks` stops git from taking its
/// opportunistic locks (e.g. the status untracked-cache refresh), so reads
/// can never collide with an agent mid-commit. Designed exactly for tools
/// like Grove that run status in the background.
pub fn git_read(workdir: &str, args: &[&str]) -> Result<String> {
    git_with_retry(workdir, &["--no-optional-locks"], args)
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

#[cfg(test)]
mod tests {
    use super::is_lock_error;

    #[test]
    fn lock_errors_are_recognised() {
        assert!(is_lock_error(
            "fatal: Unable to create 'C:/r/.git/index.lock': File exists.\n\nAnother git process seems to be running"
        ));
        assert!(is_lock_error("error: could not lock config file .git/config: index.lock held"));
        assert!(!is_lock_error("fatal: not a git repository"));
        assert!(!is_lock_error("error: pathspec 'foo' did not match any file(s)"));
    }
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
