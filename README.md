# Grove

A genuinely free, beautiful, read-first Git client that treats **worktrees as
first-class**, lets you make **small fixes inline** without opening your IDE,
and plugs into **whatever AI agent you already run** for commit messages and PR
drafts. No subscription, no vendor-locked AI.

> Working name. Easy to rename before the first public push.

## Why this exists

The Git GUI space is crowded but the genuinely-free, genuinely-beautiful slice
is nearly empty:

- GitKraken: paid (~$48/yr), AI is their own paid model, locked in.
- Tower: paid (~$69-99/yr).
- Fork / Sublime Merge: one-time paid, "free" only via a permanent nag.
- GitHub Desktop: free but feature-thin (no rich graph, no real blame).
- GitButler: free and excellent, but source-available with a no-compete
  license, and built around its own virtual-branches model.

Grove's wedge is the combination almost nobody does well:

1. **Worktree-first.** Most clients treat worktrees as an afterthought or
   ignore them. Grove makes the worktree dashboard a hero surface.
2. **Read-first, edit-light.** Open any folder and instantly get a gorgeous
   graph, blame, stash, and status. Make small fixes inline. It does not try to
   replace your editor.
3. **Bring your own agent.** Use the local `claude` / `codex` / `aider` CLI you
   already have authenticated, or paste an API key. We never lock you into a
   paid in-house model.

## Status

Pre-alpha. This repository currently contains the design and the v0 scope.
See [DESIGN.md](DESIGN.md) for the architecture and decisions.

## Stack at a glance

- Shell: Tauri (Rust core + web frontend, small binaries)
- Frontend: Svelte
- Git engine: hybrid - `gix` (gitoxide) for fast reads, the user's `git` CLI
  for writes and not-yet-covered operations
- Commit graph: custom canvas/SVG renderer (the look is the point)
- Quick edits: Monaco, scoped to small fixes only
- Agent layer: one interface, two backends (local CLI + bring-your-own API key)

## License

MIT. Free as in actually free.
