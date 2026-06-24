# Grove - Design

This document captures the thesis, the locked-in technical decisions, and the
v0 scope. It is the source of truth until the code outgrows it.

## 1. Thesis

A featherweight, genuinely free Git companion that sits beside an AI coding
editor and provides the commit/diff/worktree review surface those editors treat
as an afterthought. Read-first and beautiful, editor-agnostic (works beside any
agent, or several at once), with small inline fixes and bring-your-own agent for
commit/PR text.

The framing matters: this is not a GitKraken competitor, it is the git review
surface for the agentic coding era. The tool generating the most diffs (the
agent editor) has the worst diff UX, and Grove fills that gap from the outside.
Every feature must pass the test: would I keep this window open beside my editor
while coding?

Three pillars, in priority order:

1. Beautiful read-and-review experience (graph, diffs, stash, status) that
   refreshes live as the agent changes the repo under you.
2. Worktree dashboard as a first-class surface, increasingly central as people
   run parallel agents with one worktree per task.
3. Bring-your-own agent for commit messages and PR drafts.

Non-goals (deliberate, to avoid the "another full client" trap):

- Not a full IDE. Inline editing is for small fixes only.
- Not a virtual-branch reinvention (that lane is GitButler's).
- No in-house paid AI model, ever.

## 2. Locked decisions

| Area          | Choice                          | Why |
|---------------|---------------------------------|-----|
| Shell         | Tauri                           | Small binaries, Rust core, web UI |
| Frontend      | Svelte                          | Snappy, small bundles, good learning target |
| Git reads     | `gix` (gitoxide)                | Pure Rust, fast, no C build pain on Windows |
| Git writes    | Shell out to user's `git` CLI   | Mature coverage for commit/stash/worktree/rebase |
| Commit graph  | Custom canvas/SVG               | The visual is the differentiator |
| Inline edit   | Monaco, small-fix scope         | Familiar, syntax highlighting, but not an IDE |
| Agent layer   | One interface, two backends     | Local CLI and BYO API key from day one |
| License       | GPL-3.0                         | Free and forks stay open; AGPL's network clause is moot for a desktop app |

### The hybrid Git engine, explained

The split is by operation type, not by feature:

- `gix` handles the hot-path reads: commit walk for the graph, log, blame,
  status, diff, ref listing, worktree enumeration. These are read-heavy and
  performance-sensitive, and `gix` is fast with no C dependency.
- The user's installed `git` binary handles writes and anything `gix` does not
  yet cover cleanly: `commit`, `stash push/pop`, `worktree add/remove/prune`,
  `rebase`, `checkout`. We invoke it as a subprocess with a typed wrapper.

This sidesteps libgit2's Windows build headaches while keeping every operation
available. The wrapper boundary is a single Rust module so swapping a shelled
command for a native `gix` call later is a local change.

## 3. Architecture

```
+-------------------------------------------------------------+
|  Svelte frontend (webview)                                  |
|  - Graph canvas    - Worktree dashboard   - Diff/blame view |
|  - Monaco quick-edit pane   - Agent panel (commit/PR text)  |
+----------------------------+--------------------------------+
                             | Tauri IPC (typed commands/events)
+----------------------------v--------------------------------+
|  Rust core                                                  |
|  +----------------+  +----------------+  +----------------+ |
|  | repo::read     |  | repo::write    |  | agent          | |
|  | (gix)          |  | (git CLI)      |  | (trait + impls)| |
|  | log, graph,    |  | commit, stash, |  | local CLI /    | |
|  | blame, status, |  | worktree,      |  | API key /      | |
|  | diff, worktrees|  | rebase, checkout| | manual         | |
|  +----------------+  +----------------+  +----------------+ |
+-------------------------------------------------------------+
```

### IPC surface (initial sketch)

Read commands (gix-backed):
- `repo_open(path)` - validate, return repo summary
- `graph_page(cursor, count)` - paginated commits with parent edges for layout
- `commit_detail(oid)` - message, author, stats, changed files
- `blame(path, oid?)` - line-to-commit map
- `status()` - working tree + index state
- `worktrees()` - list with branch, head, dirty/clean, ahead/behind

Write commands (git CLI-backed):
- `stage(paths)`, `unstage(paths)`
- `commit(message, opts)`
- `stash_push(opts)`, `stash_pop(ref)`, `stash_list()`
- `worktree_add(path, branch)`, `worktree_remove(path)`, `worktree_prune()`
- `quick_edit_save(path, contents)` - write file, then stage hunk

### Agent layer

A single trait so adding a provider is a small adapter, not a feature rewrite:

```rust
trait Agent {
    fn commit_message(&self, diff: &Diff) -> Result<String>;
    fn pr_draft(&self, commits: &[Commit]) -> Result<PrDraft>;
}
```

Backends shipped in v0:

1. `LocalCliAgent` - configurable command + argv, pipe context to stdin, read
   text from stdout. Presets for `claude -p`, `codex`, `aider`. Costs the user
   nothing extra and reuses their existing auth.
2. `ApiKeyAgent` - user pastes an Anthropic or OpenAI key, we call the API
   directly. Zero CLI setup, full prompt control on our side.
3. `ManualAgent` - no-op fallback, user writes their own text.

Selection is per-repo with a global default. Keys live in the OS keychain via
the Tauri keychain plugin, never in plaintext config.

## 4. v0 scope (weekend-prototype target)

Hero feature for v0 is the worktree dashboard plus the graph, because that is
the differentiator and the fastest path to "this is clearly not just another
clone."

In:

- Open a folder, validate it is a Git repo.
- Live refresh: file-watch the repo and update graph/status/diffs as the agent
  changes things under you. Core, not optional, because the repo mutates
  constantly while an agent works.
- Commit graph: custom renderer, paginated, virtualized for large histories.
- Worktree dashboard: list, status, one-click switch, create, prune.
- Diff review as the hero UX: keyboard next/prev change, stage/unstage hunks,
  and an "everything since I last looked" view. This is the thing the agent
  editors do badly, so it has to be excellent.
- Commit detail + diff view.
- Stash list + push/pop.
- Agent panel: generate a commit message from the staged diff, using either a
  local CLI preset or a pasted API key.

Out (deliberately deferred):

- Blame view (v0.1).
- Monaco quick-edit (v0.1 - design the IPC now, build the UI after the graph).
- PR drafting and forge integration (v0.2).
- Interactive rebase UI (later; the CLI wrapper makes it possible, the UI is
  its own project).

## 5. Open questions

- Graph layout algorithm: start with a simple lane-assignment pass; revisit if
  big monorepos stutter.
- Git user identity for Grove's own commits is set per-repo, not globally.
- Naming: "Grove" is a working title.

## 6. Decision log

- Frontend: Svelte (chosen to also learn it).
- Git engine: gix for reads + git CLI for writes (hybrid, by operation type).
- Graph: custom canvas/SVG over a JS graph library, for full control of look.
- Agent: both local-CLI and API-key backends from day one, behind one trait.
- License: GPL-3.0 (copyleft to stop proprietary forks; AGPL rejected because
  its network clause does nothing for a desktop app).
- Positioning: reframed as a companion to AI coding editors, not a general Git
  client. Live refresh and diff navigation promoted to core v0 requirements.
