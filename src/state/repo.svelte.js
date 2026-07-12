// Single entry point for backend-pushed repo state.
//
// The Rust RepoService recomputes state slices when the repo changes (watcher
// events or Grove's own writes) and pushes typed `repo-event` payloads, each
// tagged with a generation number and the repo root it belongs to. This module
// owns the one event subscription: it drops anything stale (older gen) or
// foreign (different root), so consumers can trust every value they see here.
import { listen } from "@tauri-apps/api/event";

export const repoState = $state({
  path: "",
  graph: null, // { head, commits, unpushed }
  status: null, // WorkingStatus
  dirty: null, // null until the first StatusChanged
  worktrees: null,
  branches: null,
  lastError: null, // { op, message } from a failed refresh slice
});

const gens = { graph: 0, status: 0, worktrees: 0, branches: 0 };
let attached = false;

function fresh(domain, gen) {
  if (gen < gens[domain]) return false;
  gens[domain] = gen;
  return true;
}

export function attachRepoEvents() {
  if (attached) return;
  attached = true;
  listen("repo-event", ({ payload: e }) => {
    if (e.root !== repoState.path) return; // event from a previously open repo
    switch (e.kind) {
      case "graph_changed":
        if (fresh("graph", e.gen))
          repoState.graph = { head: e.head, commits: e.commits, unpushed: e.unpushed };
        break;
      case "status_changed":
        if (fresh("status", e.gen)) {
          repoState.status = e.status;
          repoState.dirty = e.dirty;
        }
        break;
      case "worktrees_changed":
        if (fresh("worktrees", e.gen)) repoState.worktrees = e.worktrees;
        break;
      case "branches_changed":
        if (fresh("branches", e.gen)) repoState.branches = e.branches;
        break;
      case "refresh_error":
        repoState.lastError = { op: e.op, message: e.message };
        break;
    }
  });
}

// Call when opening or leaving a repo so state never bleeds across repos.
export function resetRepoState(path = "") {
  repoState.path = path;
  repoState.graph = null;
  repoState.status = null;
  repoState.dirty = null;
  repoState.worktrees = null;
  repoState.branches = null;
  repoState.lastError = null;
  gens.graph = gens.status = gens.worktrees = gens.branches = 0;
}
