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
