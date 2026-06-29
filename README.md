# Grove

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-pre--alpha-orange.svg)](#status)
[![Built with](https://img.shields.io/badge/built%20with-Tauri%20%2B%20Svelte-ff3e00.svg)](#stack-at-a-glance)

A featherweight Git companion that sits beside your AI coding editor and gives
you the commit, diff, and worktree review surface those editors treat as an
afterthought. Read-first and beautiful: open any folder and instantly see the
graph, diffs, stash, status, and every in-flight worktree, refreshing live as
the agent changes things under you. Make **small fixes inline**, and use
**whatever AI agent you already run** for commit messages and PR drafts.
Genuinely free, no subscription, no vendor-locked AI.

> Working name. Easy to rename before the first public push.

## Why this exists

AI coding editors (Claude, Cursor, Windsurf, and the rest) pour everything into
the chat-and-agent loop and treat git review as a cramped side panel. But the
agent generates a huge volume of diffs and commits fast, so the thing you most
need is a great surface to see and review what it did. The tool creating the
most diffs has the worst diff UX. Grove is the editor-agnostic companion that
fills that gap: it works beside any agent, including several at once.

The wider Git GUI space is also crowded, yet the genuinely-free,
genuinely-beautiful slice is nearly empty:

- GitKraken: paid (~$48/yr), AI is their own paid model, locked in.
- Tower: paid (~$69-99/yr).
- Fork / Sublime Merge: one-time paid, "free" only via a permanent nag.
- GitHub Desktop: free but feature-thin (no rich graph, no real blame).
- GitButler: free and excellent, but source-available with a no-compete
  license, and built around its own virtual-branches model.

Grove's wedge is the combination almost nobody does well:

1. **Worktree-first.** Most clients ignore worktrees, yet parallel agents and
   one-worktree-per-task workflows are fast becoming how people run multiple
   agents at once. Grove makes the worktree dashboard a hero surface.
2. **Read-first, edit-light.** Open any folder and instantly get a gorgeous
   graph, blame, stash, and status. Make small fixes inline. It does not try to
   replace your editor.
3. **Bring your own agent.** Use the local `claude` / `codex` / `aider` CLI you
   already have authenticated, or paste an API key. We never lock you into a
   paid in-house model.

## Status

Pre-alpha. The app scaffold builds and runs: a Tauri 2 + Svelte 5 shell with a
Rust core that opens a folder and reports whether it is a git repo (the first
slice of the read path). The v0 hero features (worktree dashboard, commit graph,
diff review, live refresh) are next. See [DESIGN.md](DESIGN.md) for the
architecture and decisions.

## Running it

Prerequisites: Rust, Node 18+ (Node 22.12+ recommended), and on Windows the
MSVC C++ build tools plus the WebView2 runtime.

    npm install
    npm run tauri dev

The first Rust build compiles Tauri and gix and takes several minutes; later
builds are incremental.

## Stack at a glance

- Shell: Tauri (Rust core + web frontend, small binaries)
- Frontend: Svelte
- Git engine: hybrid - `gix` (gitoxide) for fast reads, the user's `git` CLI
  for writes and not-yet-covered operations
- Commit graph: custom canvas/SVG renderer (the look is the point)
- Quick edits: Monaco, scoped to small fixes only
- Agent layer: one interface, two backends (local CLI + bring-your-own API key)

## License

GPL-3.0. Free as in actually free, and forks stay open.

---

Built by [capad](https://github.com/capad-xyz). Questions or feedback: oss@capad.fyi.
