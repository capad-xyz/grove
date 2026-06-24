//! Bring-your-own-agent layer (see DESIGN.md section 3). One trait, multiple
//! backends so adding a provider is a small adapter, not a feature rewrite.
//!
//! v0 ships the trait and the `Manual` fallback. `LocalCli` (shell out to an
//! installed `claude`/`codex`/`aider`) and `ApiKey` (Anthropic/OpenAI) backends
//! land next, behind this same interface.

// Scaffolding: these are defined ahead of the UI that will call them.
#![allow(dead_code)]

use anyhow::Result;

#[derive(Debug, Clone)]
pub struct PrDraft {
    pub title: String,
    pub body: String,
}

pub trait Agent {
    /// Draft a commit message from a unified diff.
    fn commit_message(&self, diff: &str) -> Result<String>;
    /// Draft a PR title and body from a set of commit summaries.
    fn pr_draft(&self, commits: &[String]) -> Result<PrDraft>;
}

/// No-op backend: the user writes their own text.
pub struct Manual;

impl Agent for Manual {
    fn commit_message(&self, _diff: &str) -> Result<String> {
        Ok(String::new())
    }

    fn pr_draft(&self, _commits: &[String]) -> Result<PrDraft> {
        Ok(PrDraft {
            title: String::new(),
            body: String::new(),
        })
    }
}

// --- Local CLI agent (claude / codex / aider that the user already has) ---

use std::io::Write;
use std::process::{Command, Stdio};

/// Build the process for a CLI agent command string. On Windows we go through
/// cmd.exe so npm-installed shims (claude.cmd, codex.cmd) resolve from PATH.
#[cfg(windows)]
fn build_command(cmd: &str) -> Command {
    let mut c = Command::new("cmd");
    c.arg("/C").arg(cmd);
    c
}
#[cfg(not(windows))]
fn build_command(cmd: &str) -> Command {
    let mut parts = cmd.split_whitespace();
    let mut c = Command::new(parts.next().unwrap_or("sh"));
    for a in parts {
        c.arg(a);
    }
    c
}

/// Run a CLI agent, piping `input` to stdin and returning trimmed stdout.
fn run_cli(cmd: &str, input: &str) -> Result<String> {
    let mut child = build_command(cmd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| anyhow::anyhow!("could not start agent '{cmd}': {e}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| anyhow::anyhow!("no stdin handle"))?
        .write_all(input.as_bytes())?;
    let out = child.wait_with_output()?;
    if !out.status.success() {
        anyhow::bail!(
            "agent '{cmd}' failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Generate a commit message from a staged diff using a local CLI agent
/// (defaults to `claude -p`, which reads the prompt from stdin).
pub fn generate_message(diff: &str, cmd: Option<&str>) -> Result<String> {
    let cmd = cmd.unwrap_or("claude -p");
    let prompt = format!(
        "Write a single concise git commit message for the staged diff below. \
Use conventional-commits style (for example, \"fix(auth): handle expired token\"). \
Output ONLY the commit message text: no preamble, no quotes, no code fences.\n\n{diff}"
    );
    let msg = run_cli(cmd, &prompt)?;
    Ok(msg.trim().trim_matches('`').trim_matches('"').trim().to_string())
}
