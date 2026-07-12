//! Repo-state service: the single source of truth for "when does state refresh".
//!
//! One coordinator task per watched repo turns classified invalidations (from
//! the file watcher or from Grove's own write commands) into recomputed state
//! slices, compares them against the last emitted values, and pushes typed
//! `repo-event` payloads to the frontend. Every payload carries a generation
//! number so the frontend can drop anything stale. Nothing else in the app
//! re-fetches on its own; every refresh trigger funnels through `poke`.

use super::read;
use super::{CommitNode, WorkingStatus, Worktree};
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::sync::mpsc;

/// Invalidation bits: which parts of repo state a change may have touched.
pub const INV_REFS: u8 = 1 << 0; // .git/refs, HEAD, packed-refs → graph, branches, unpushed
pub const INV_INDEX: u8 = 1 << 1; // .git/index → staged status (agents staging files)
pub const INV_WORKDIR: u8 = 1 << 2; // working-tree file edits → status, dirty
pub const INV_WORKTREES: u8 = 1 << 3; // .git/worktrees metadata
pub const INV_FULL: u8 = INV_REFS | INV_INDEX | INV_WORKDIR | INV_WORKTREES;

/// Typed refresh payloads pushed to the frontend on the `repo-event` channel.
#[derive(Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum RepoEvent {
    GraphChanged {
        gen: u64,
        head: Option<String>,
        commits: Vec<CommitNode>,
        unpushed: Vec<String>,
    },
    StatusChanged {
        gen: u64,
        status: WorkingStatus,
        dirty: bool,
    },
    WorktreesChanged {
        gen: u64,
        worktrees: Vec<Worktree>,
    },
    BranchesChanged {
        gen: u64,
        branches: Vec<String>,
    },
    RefreshError {
        gen: u64,
        op: String,
        message: String,
    },
}

/// Envelope so the frontend can discard events from a previously open repo.
#[derive(Serialize)]
struct Envelope<'a> {
    root: &'a str,
    #[serde(flatten)]
    event: &'a RepoEvent,
}

pub struct RepoService {
    tx: mpsc::UnboundedSender<u8>,
}

impl RepoService {
    /// Spawn the coordinator for `root`. Dropping the returned service closes
    /// the channel, which ends the coordinator task.
    pub fn start(app: tauri::AppHandle, root: String) -> Arc<Self> {
        let (tx, rx) = mpsc::unbounded_channel();
        tauri::async_runtime::spawn(coordinator(app, root, rx));
        Arc::new(Self { tx })
    }

    /// Queue an invalidation; the coordinator coalesces bursts into one cycle.
    pub fn poke(&self, bits: u8) {
        let _ = self.tx.send(bits);
    }
}

/// Last emitted values, so unchanged slices emit nothing (no spurious
/// re-renders on the frontend).
#[derive(Default)]
struct Cache {
    graph: Option<(Option<String>, Vec<CommitNode>, Vec<String>)>,
    status: Option<WorkingStatus>,
    worktrees: Option<Vec<Worktree>>,
    branches: Option<Vec<String>>,
}

async fn coordinator(app: tauri::AppHandle, root: String, mut rx: mpsc::UnboundedReceiver<u8>) {
    let gen = AtomicU64::new(0);
    let mut cache = Cache::default();

    while let Some(first) = rx.recv().await {
        let mut bits = first;
        // Coalesce: keep draining while events arrive in quick succession, but
        // never sit on a change for more than ~350ms total. Direct user
        // actions (a lone stage click) therefore land in ~80ms, while an
        // agent's save-storm collapses into one cycle.
        let started = Instant::now();
        loop {
            match tokio::time::timeout(Duration::from_millis(80), rx.recv()).await {
                Ok(Some(b)) => {
                    bits |= b;
                    if started.elapsed() > Duration::from_millis(350) {
                        break;
                    }
                }
                Ok(None) => return, // service dropped: stop the task
                Err(_) => break,    // quiet for 80ms: run the cycle
            }
        }
        let g = gen.fetch_add(1, Ordering::SeqCst) + 1;
        run_cycle(&app, &root, bits, g, &mut cache).await;
        // Invalidations that arrived mid-cycle are still queued and start the
        // next cycle immediately, so nothing is ever lost — only coalesced.
    }
}

async fn run_cycle(app: &tauri::AppHandle, root: &str, bits: u8, gen: u64, cache: &mut Cache) {
    let want_graph = bits & INV_REFS != 0;
    let want_status = bits & (INV_INDEX | INV_WORKDIR) != 0;
    let want_worktrees = bits & (INV_REFS | INV_INDEX | INV_WORKTREES) != 0;
    let want_branches = bits & INV_REFS != 0;

    // Kick off every dirty slice at once; each runs on the blocking pool.
    let graph_task = want_graph.then(|| {
        let p = root.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let commits = read::graph(&p, 400, None)?;
            let unpushed = read::unpushed_commits(&p).unwrap_or_default();
            let head = read::open(&p).ok().and_then(|r| r.head);
            anyhow::Ok((head, commits, unpushed))
        })
    });
    let status_task = want_status.then(|| {
        let p = root.to_string();
        tauri::async_runtime::spawn_blocking(move || read::working_status(&p))
    });
    let worktrees_task = want_worktrees.then(|| {
        let p = root.to_string();
        tauri::async_runtime::spawn_blocking(move || read::worktrees(&p))
    });
    let branches_task = want_branches.then(|| {
        let p = root.to_string();
        tauri::async_runtime::spawn_blocking(move || read::branches(&p))
    });

    if let Some(t) = graph_task {
        match flatten(t.await) {
            Ok(v) => {
                if cache.graph.as_ref() != Some(&v) {
                    emit(
                        app,
                        root,
                        &RepoEvent::GraphChanged {
                            gen,
                            head: v.0.clone(),
                            commits: v.1.clone(),
                            unpushed: v.2.clone(),
                        },
                    );
                    cache.graph = Some(v);
                }
            }
            Err(e) => emit_err(app, root, gen, "graph", e),
        }
    }
    if let Some(t) = status_task {
        match flatten(t.await) {
            Ok(s) => {
                if cache.status.as_ref() != Some(&s) {
                    let dirty =
                        !(s.staged.is_empty() && s.unstaged.is_empty() && s.untracked.is_empty());
                    emit(
                        app,
                        root,
                        &RepoEvent::StatusChanged {
                            gen,
                            status: s.clone(),
                            dirty,
                        },
                    );
                    cache.status = Some(s);
                }
            }
            Err(e) => emit_err(app, root, gen, "status", e),
        }
    }
    if let Some(t) = worktrees_task {
        match flatten(t.await) {
            Ok(w) => {
                if cache.worktrees.as_ref() != Some(&w) {
                    emit(
                        app,
                        root,
                        &RepoEvent::WorktreesChanged {
                            gen,
                            worktrees: w.clone(),
                        },
                    );
                    cache.worktrees = Some(w);
                }
            }
            Err(e) => emit_err(app, root, gen, "worktrees", e),
        }
    }
    if let Some(t) = branches_task {
        match flatten(t.await) {
            Ok(b) => {
                if cache.branches.as_ref() != Some(&b) {
                    emit(
                        app,
                        root,
                        &RepoEvent::BranchesChanged {
                            gen,
                            branches: b.clone(),
                        },
                    );
                    cache.branches = Some(b);
                }
            }
            Err(e) => emit_err(app, root, gen, "branches", e),
        }
    }
}

/// Collapse a JoinError or a slice error into one anyhow error.
fn flatten<T>(joined: Result<anyhow::Result<T>, tauri::Error>) -> anyhow::Result<T> {
    match joined {
        Ok(inner) => inner,
        Err(e) => Err(anyhow::anyhow!("task join failed: {e}")),
    }
}

fn emit(app: &tauri::AppHandle, root: &str, event: &RepoEvent) {
    let _ = app.emit("repo-event", &Envelope { root, event });
}

fn emit_err(app: &tauri::AppHandle, root: &str, gen: u64, op: &str, e: anyhow::Error) {
    emit(
        app,
        root,
        &RepoEvent::RefreshError {
            gen,
            op: op.to_string(),
            message: e.to_string(),
        },
    );
}
