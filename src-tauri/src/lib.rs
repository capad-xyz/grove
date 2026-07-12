mod agent;
mod repo;

use notify::RecommendedWatcher;
use repo::service::{RepoService, INV_FULL, INV_INDEX, INV_WORKDIR};
use repo::{
    BlameLine, CommitDetail, CommitNode, DirListing, GrepHit, RepoSummary, WorkingStatus, Worktree,
};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Manager;

/// The active watcher + repo service pair for the currently open repository.
/// Replacing it drops the previous watcher (stopping it) and closes the old
/// service's channel (ending its coordinator task).
#[derive(Default)]
struct WatchState(Mutex<Option<(RecommendedWatcher, Arc<RepoService>)>>);

impl WatchState {
    /// Nudge the live repo service, if one is running. Write commands call
    /// this so a stage/commit refreshes state through the same coordinated
    /// pipeline as watcher events (no parallel racing fetches).
    fn poke(&self, bits: u8) {
        if let Some((_, svc)) = self.0.lock().unwrap().as_ref() {
            svc.poke(bits);
        }
    }
}

/// Run a blocking git/gix read on the blocking pool. Commands are `async` so
/// they stay off the main thread — a sync command would run its subprocess on
/// the UI event loop and freeze the window for its duration.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

/// Open a folder and return a summary if it is a git repository.
#[tauri::command]
async fn repo_open(path: String) -> Result<RepoSummary, String> {
    blocking(move || repo::read::open(&path).map_err(|e| e.to_string())).await
}

/// Return up to `limit` commits for the graph view. `refspec` filters to a
/// single branch/ref; omit (or empty) for all refs.
#[tauri::command]
async fn commit_graph(
    path: String,
    limit: u32,
    refspec: Option<String>,
) -> Result<Vec<CommitNode>, String> {
    blocking(move || {
        repo::read::graph(&path, limit, refspec.as_deref()).map_err(|e| e.to_string())
    })
    .await
}

/// Local branch names for the branch filter.
#[tauri::command]
async fn branches(path: String) -> Result<Vec<String>, String> {
    blocking(move || repo::read::branches(&path).map_err(|e| e.to_string())).await
}

/// Metadata and changed files for one commit.
#[tauri::command]
async fn commit_detail(path: String, oid: String) -> Result<CommitDetail, String> {
    blocking(move || repo::read::commit_detail(&path, &oid).map_err(|e| e.to_string())).await
}

/// Unified diff for one file within a commit.
#[tauri::command]
async fn file_diff(path: String, oid: String, file: String) -> Result<String, String> {
    blocking(move || repo::read::file_diff(&path, &oid, &file).map_err(|e| e.to_string())).await
}

/// List sub-folders for the custom folder picker.
#[tauri::command]
async fn list_dir(path: String) -> Result<DirListing, String> {
    blocking(move || repo::read::list_dir(&path).map_err(|e| e.to_string())).await
}

/// List the repository's linked working trees.
#[tauri::command]
async fn worktrees(path: String) -> Result<Vec<Worktree>, String> {
    blocking(move || repo::read::worktrees(&path).map_err(|e| e.to_string())).await
}

/// Full SHAs of unpushed (local-only) commits.
#[tauri::command]
async fn unpushed_commits(path: String) -> Result<Vec<String>, String> {
    blocking(move || repo::read::unpushed_commits(&path).map_err(|e| e.to_string())).await
}

/// All tracked file paths (for the file finder).
#[tauri::command]
async fn list_files(path: String) -> Result<Vec<String>, String> {
    blocking(move || repo::read::list_files(&path).map_err(|e| e.to_string())).await
}

/// Every file path that has ever existed in the repo (for spotlight search).
#[tauri::command]
async fn all_files(path: String) -> Result<Vec<String>, String> {
    blocking(move || repo::read::all_files(&path).map_err(|e| e.to_string())).await
}

/// Commits whose message matches a query (for spotlight search).
#[tauri::command]
async fn search_commits(path: String, query: String) -> Result<Vec<CommitNode>, String> {
    blocking(move || repo::read::search_commits(&path, &query).map_err(|e| e.to_string())).await
}

/// Content search across tracked files.
#[tauri::command]
async fn grep_repo(path: String, query: String) -> Result<Vec<GrepHit>, String> {
    blocking(move || repo::read::grep_repo(&path, &query).map_err(|e| e.to_string())).await
}

/// Commits that touched a file.
#[tauri::command]
async fn file_history(path: String, file: String) -> Result<Vec<CommitNode>, String> {
    blocking(move || repo::read::file_history(&path, &file).map_err(|e| e.to_string())).await
}

/// Diff of one file between two revisions.
#[tauri::command]
async fn file_diff_between(
    path: String,
    a: String,
    b: String,
    file: String,
) -> Result<String, String> {
    blocking(move || {
        repo::read::file_diff_between(&path, &a, &b, &file).map_err(|e| e.to_string())
    })
    .await
}

/// Contents of a file at a revision (quick view).
#[tauri::command]
async fn file_at(path: String, rev: String, file: String) -> Result<String, String> {
    blocking(move || repo::read::file_at(&path, &rev, &file).map_err(|e| e.to_string())).await
}

/// Per-line blame for a file.
#[tauri::command]
async fn blame(path: String, file: String) -> Result<Vec<BlameLine>, String> {
    blocking(move || repo::read::blame(&path, &file).map_err(|e| e.to_string())).await
}

// --- Working tree (source control) ---

#[tauri::command]
async fn working_status(path: String) -> Result<WorkingStatus, String> {
    blocking(move || repo::read::working_status(&path).map_err(|e| e.to_string())).await
}

#[tauri::command]
async fn working_diff(path: String, file: String, staged: bool) -> Result<String, String> {
    blocking(move || repo::read::working_diff(&path, &file, staged).map_err(|e| e.to_string()))
        .await
}

#[tauri::command]
async fn working_file(path: String, file: String) -> Result<String, String> {
    blocking(move || repo::read::working_file(&path, &file).map_err(|e| e.to_string())).await
}

#[tauri::command]
async fn stage_file(
    state: tauri::State<'_, WatchState>,
    path: String,
    file: String,
) -> Result<(), String> {
    blocking(move || repo::write::stage(&path, &file).map_err(|e| e.to_string())).await?;
    state.poke(INV_INDEX | INV_WORKDIR);
    Ok(())
}

#[tauri::command]
async fn unstage_file(
    state: tauri::State<'_, WatchState>,
    path: String,
    file: String,
) -> Result<(), String> {
    blocking(move || repo::write::unstage(&path, &file).map_err(|e| e.to_string())).await?;
    state.poke(INV_INDEX | INV_WORKDIR);
    Ok(())
}

#[tauri::command]
async fn stage_all(state: tauri::State<'_, WatchState>, path: String) -> Result<(), String> {
    blocking(move || repo::write::stage_all(&path).map_err(|e| e.to_string())).await?;
    state.poke(INV_INDEX | INV_WORKDIR);
    Ok(())
}

#[tauri::command]
async fn unstage_all(state: tauri::State<'_, WatchState>, path: String) -> Result<(), String> {
    blocking(move || repo::write::unstage_all(&path).map_err(|e| e.to_string())).await?;
    state.poke(INV_INDEX | INV_WORKDIR);
    Ok(())
}

#[tauri::command]
async fn commit_changes(
    state: tauri::State<'_, WatchState>,
    path: String,
    message: String,
) -> Result<String, String> {
    let out = blocking(move || repo::write::commit(&path, &message).map_err(|e| e.to_string()))
        .await?;
    state.poke(INV_FULL);
    Ok(out)
}

/// Ask the repo service for a full refresh (e.g. after an external operation).
#[tauri::command]
async fn refresh_repo(state: tauri::State<'_, WatchState>) -> Result<(), String> {
    state.poke(INV_FULL);
    Ok(())
}

/// Whether a repo has uncommitted changes (for the sidebar).
#[tauri::command]
async fn repo_dirty(path: String) -> bool {
    tauri::async_runtime::spawn_blocking(move || repo::read::is_dirty(&path).unwrap_or(false))
        .await
        .unwrap_or(false)
}

/// Generate a commit message from the staged diff using a local CLI agent.
#[tauri::command]
async fn generate_commit_message(path: String) -> Result<String, String> {
    blocking(move || {
        let diff = repo::read::staged_diff(&path).map_err(|e| e.to_string())?;
        if diff.trim().is_empty() {
            return Err("Stage some changes first.".into());
        }
        agent::generate_message(&diff, None).map_err(|e| e.to_string())
    })
    .await
}

/// Clone `url` into `~/GroveRepos/<name>` and return the local path.
#[tauri::command]
async fn clone_repo(url: String) -> Result<String, String> {
    blocking(move || {
        let name = url
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or("repo")
            .trim_end_matches(".git");
        if name.is_empty() {
            return Err("could not derive a repo name from the URL".into());
        }
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .map_err(|_| "no home directory".to_string())?;
        let parent = PathBuf::from(home).join("GroveRepos");
        std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
        let dest = parent.join(name);
        if dest.exists() {
            return Err(format!("{} already exists", dest.display()));
        }
        let dest = dest.display().to_string();
        repo::write::clone(&url, &dest).map_err(|e| e.to_string())?;
        Ok(dest)
    })
    .await
}

// --- Recently opened repositories (persisted in the app config dir) ---

#[derive(Serialize, Deserialize, Clone)]
struct RecentRepo {
    path: String,
    name: String,
}

fn recents_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("recents.json"))
}

fn read_recents(app: &tauri::AppHandle) -> Vec<RecentRepo> {
    let path = match recents_path(app) {
        Ok(p) => p,
        Err(_) => return vec![],
    };
    let raw: Vec<RecentRepo> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|d| serde_json::from_str(&d).ok())
        .unwrap_or_default();
    // Collapse any duplicates already stored (first occurrence wins).
    let mut seen = std::collections::HashSet::new();
    raw.into_iter()
        .filter(|r| seen.insert(norm_path(&r.path).to_lowercase()))
        .collect()
}

#[tauri::command]
fn recent_repos(app: tauri::AppHandle) -> Vec<RecentRepo> {
    read_recents(&app)
}

/// Normalize a path for comparison so "C:\\x" and "C:/x/" dedupe as one.
fn norm_path(p: &str) -> String {
    p.replace('\\', "/").trim_end_matches('/').to_string()
}

#[tauri::command]
fn add_recent_repo(app: tauri::AppHandle, path: String, name: String) -> Vec<RecentRepo> {
    let path = norm_path(&path);
    let mut list = read_recents(&app);
    list.retain(|r| !norm_path(&r.path).eq_ignore_ascii_case(&path));
    list.insert(0, RecentRepo { path, name });
    list.truncate(10);
    if let Ok(p) = recents_path(&app) {
        let _ = std::fs::write(p, serde_json::to_string_pretty(&list).unwrap_or_default());
    }
    list
}

/// Start the repo service + classified watcher for `path`. State updates are
/// pushed as `repo-event` payloads; see `repo::service`. Replaces any previous
/// pair (so switching repos stops the old watcher and coordinator).
#[tauri::command]
fn watch_repo(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchState>,
    path: String,
) -> Result<(), String> {
    let svc = RepoService::start(app, path.clone());
    let watcher = repo::watch::start_watcher(svc.clone(), &path).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some((watcher, svc));
    Ok(())
}

/// Stop watching the current repository.
#[tauri::command]
fn unwatch_repo(state: tauri::State<'_, WatchState>) {
    *state.0.lock().unwrap() = None;
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatchState::default())
        .invoke_handler(tauri::generate_handler![
            repo_open,
            commit_graph,
            branches,
            commit_detail,
            file_diff,
            list_dir,
            worktrees,
            unpushed_commits,
            list_files,
            all_files,
            search_commits,
            grep_repo,
            file_history,
            file_diff_between,
            file_at,
            blame,
            working_status,
            working_diff,
            working_file,
            stage_file,
            unstage_file,
            stage_all,
            unstage_all,
            commit_changes,
            refresh_repo,
            generate_commit_message,
            repo_dirty,
            clone_repo,
            watch_repo,
            unwatch_repo,
            recent_repos,
            add_recent_repo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
