mod agent;
mod repo;

use repo::{CommitNode, RepoSummary};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![repo_open, commit_graph])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
