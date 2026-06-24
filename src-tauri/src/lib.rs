mod agent;
mod repo;

use repo::{CommitDetail, CommitNode, DirListing, GrepHit, RepoSummary, Worktree};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;

/// Open a folder and return a summary if it is a git repository.
/// Reads go through `gix`; see `repo::read`.
#[tauri::command]
fn repo_open(path: String) -> Result<RepoSummary, String> {
    repo::read::open(&path).map_err(|e| e.to_string())
}

/// Return up to `limit` commits across all refs for the graph view.
#[tauri::command]
fn commit_graph(path: String, limit: u32) -> Result<Vec<CommitNode>, String> {
    repo::read::graph(&path, limit).map_err(|e| e.to_string())
}

/// Metadata and changed files for one commit.
#[tauri::command]
fn commit_detail(path: String, oid: String) -> Result<CommitDetail, String> {
    repo::read::commit_detail(&path, &oid).map_err(|e| e.to_string())
}

/// Unified diff for one file within a commit.
#[tauri::command]
fn file_diff(path: String, oid: String, file: String) -> Result<String, String> {
    repo::read::file_diff(&path, &oid, &file).map_err(|e| e.to_string())
}

/// List sub-folders for the custom folder picker.
#[tauri::command]
fn list_dir(path: String) -> Result<DirListing, String> {
    repo::read::list_dir(&path).map_err(|e| e.to_string())
}

/// List the repository's linked working trees.
#[tauri::command]
fn worktrees(path: String) -> Result<Vec<Worktree>, String> {
    repo::read::worktrees(&path).map_err(|e| e.to_string())
}

/// Full SHAs of unpushed (local-only) commits.
#[tauri::command]
fn unpushed_commits(path: String) -> Result<Vec<String>, String> {
    repo::read::unpushed_commits(&path).map_err(|e| e.to_string())
}

/// All tracked file paths (for the file finder).
#[tauri::command]
fn list_files(path: String) -> Result<Vec<String>, String> {
    repo::read::list_files(&path).map_err(|e| e.to_string())
}

/// Content search across tracked files.
#[tauri::command]
fn grep_repo(path: String, query: String) -> Result<Vec<GrepHit>, String> {
    repo::read::grep_repo(&path, &query).map_err(|e| e.to_string())
}

/// Commits that touched a file.
#[tauri::command]
fn file_history(path: String, file: String) -> Result<Vec<CommitNode>, String> {
    repo::read::file_history(&path, &file).map_err(|e| e.to_string())
}

/// Diff of one file between two revisions.
#[tauri::command]
fn file_diff_between(path: String, a: String, b: String, file: String) -> Result<String, String> {
    repo::read::file_diff_between(&path, &a, &b, &file).map_err(|e| e.to_string())
}

/// Contents of a file at a revision (quick view).
#[tauri::command]
fn file_at(path: String, rev: String, file: String) -> Result<String, String> {
    repo::read::file_at(&path, &rev, &file).map_err(|e| e.to_string())
}

/// Clone `url` into `~/GroveRepos/<name>` and return the local path.
#[tauri::command]
fn clone_repo(url: String) -> Result<String, String> {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            repo_open,
            commit_graph,
            commit_detail,
            file_diff,
            list_dir,
            worktrees,
            unpushed_commits,
            list_files,
            grep_repo,
            file_history,
            file_diff_between,
            file_at,
            clone_repo,
            recent_repos,
            add_recent_repo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
