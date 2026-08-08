# Grove

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue.svg)](LICENSE)
[![Status](https://img.shields.io/badge/status-alpha-orange.svg)](#status)
[![Built with](https://img.shields.io/badge/built%20with-Electron%20%2B%20React-47848f.svg)](#stack-at-a-glance)

A featherweight Git companion that sits beside your AI coding editor and gives
you the commit, diff, and worktree review surface those editors treat as an
afterthought. Read-first and beautiful: open any folder and instantly see the
graph, diffs, status, and every in-flight worktree, refreshing live as the agent
changes things under you. Make **small fixes inline**, and use **whatever AI
agent you already run** for commit messages and PR drafts. Genuinely free, no
subscription, no vendor-locked AI.

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

Alpha. Grove was re-authored off Tauri + Svelte onto Electron + React +
TypeScript, with the git engine ported from Rust to Node. The full list of what
landed is in [CHANGELOG.md](CHANGELOG.md).

The shipped [v0.1.x line](https://github.com/capad-xyz/grove/releases) was the
Tauri build; its final state on `main` is tagged
[`v0.1.3-legacy`](https://github.com/capad-xyz/grove/releases/tag/v0.1.3-legacy)
and still builds from `src/` and `src-tauri/`. Two things it had are
**deliberately not carried over**: syntax highlighting in diffs, and the
back/forward navigation hub. Two others simply are not built yet — hover cards
on commit nodes, and deferring the live refresh while you scroll.

**Works today.** Open any repository (native chooser, drag-and-drop, typed path,
or clone), browse a virtualised commit list with a real lane-drawn graph, read
diffs with find-in-diff and a rendered Markdown preview, stage and unstage and
commit, draft a commit message with a local CLI agent, search
files/branches/commits/contents from one field, and see a
"since you last looked" boundary that means *since this window last had focus*.
Images render inside the diff, video and audio play, and anything else binary is
described rather than decoded. It refreshes live as an agent writes to the repo,
it is drivable from the keyboard, and it packages into an installer.

**Not built yet.** No stash surface. No blame UI (the engine has `blame`;
nothing consumes it). No inline editing. The worktree strip lists worktrees but
cannot add, remove, prune, or switch. The agent layer has the local-CLI backend
only — no API-key backend, and the command is not configurable from the
interface. The commit list loads a fixed 200 commits. There is no settings
surface, no code signing, no auto-updater, and no CI. Builds and measurements so
far are Windows-only, and because the installers are unsigned, SmartScreen will
warn on first run.

For the product thesis and the v0 scope, see [DESIGN.md](DESIGN.md) — note that
its "locked decisions" table predates the re-author and still describes the
Tauri stack. For how the interface looks and why every value is what it is, see
[app/DESIGN-SYSTEM.md](app/DESIGN-SYSTEM.md), which is the source of truth for
the UI.

## Running it

Prerequisites: **Node 22.18+** and **`git` on `PATH`** — git is a runtime
requirement, not just a build one, because every operation shells out to it.
Nothing else. Rust, the MSVC build tools, and the WebView2 runtime are only
needed for the retained Tauri tree.

    cd engine && npm install
    cd ../app && npm install
    npm run dev

`npm run dev` builds the engine first, then starts Vite and Electron with HMR in
the renderer.

All the app commands, from `app/`:

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server + Electron, HMR in the renderer |
| `npm run dev:renderer` | Renderer only, in a browser, on fixtures (fast design loop, pinned to 127.0.0.1:5180) |
| `npm run check` | Typecheck (3 configs) + the 85 renderer tests |
| `npm run smoke` | 25 headless end-to-end checks that drive the real bridge |
| `npm run build` | Cleans `out/`, then builds engine + main + preload + renderer |
| `npm run package:dir` | Unpacked build into `release/`, no installer |
| `npm run package` | Full installer for the host platform |

And from `engine/`, `npm run check` typechecks and runs the 45 engine tests.
They run straight off the TypeScript source via Node's type-stripping, so there
is no build step for the test suite.

`npm run smoke` is the one that matters. It drives the real path — page script
calls `window.grove.*`, which crosses contextBridge → ipcRenderer → ipcMain →
engine and back — with the window hidden so it never steals focus, and it
asserts that `require`, `process`, and `module` are absent from the renderer.
Its write checks run against a throwaway repository created per run, never the
one you point it at.

If `npm install` in `app/` finishes but Electron fails to start with
`Error: Electron uninstall`, its binary did not download: run
`node node_modules/electron/install.js`.

## Project layout

    engine/       @grove/engine — the headless git engine. Spawns `git`, parses
                  stdout, classifies watcher events, coalesces refreshes. No UI.
    app/          The Electron shell: main process, the hardened preload bridge,
                  and the React renderer.
    src-tauri/    The original Rust core. Retained, untouched since the port, as
                  the reference implementation.
    src/          The original Svelte 5 frontend. Retained for the same reason.
    DESIGN.md     Thesis, positioning, v0 scope. Predates the re-author.
    RUNBOOK.md    Operational notes — still written against the Tauri build.
    CHANGELOG.md  What changed, with the numbers.

The engine knows nothing about Electron and the renderer knows nothing about
Node: the renderer reaches the engine only through `window.grove`, and only
through the `data/source.ts` seam, which serves fixtures when there is no
bridge.

## Stack at a glance

- Shell: Electron 43 — sandboxed renderer, context isolation, a preload bridge
  typed as `GroveApi` so a missing method is a compile error
- Frontend: React 19 + TypeScript
- Git engine: the user's own `git` binary, spawned and parsed. Repository
  discovery is an in-process upward walk; there is no native dependency
- Commit graph: custom SVG renderer, one small SVG per row (the look is the point)
- Agent layer: one interface, local CLI backend today (`claude -p` by default),
  API-key backend still to come

Grove renders diffs and commit messages from repositories it did not write and
cannot vet, so the renderer is locked down hard: `nodeIntegration: false`,
`app.enableSandbox()` process-wide, a CSP on every response, popups denied,
`http(s)` links handed to the real browser, in-place navigation blocked, and
every permission request refused.

## License

GPL-3.0. Free as in actually free, and forks stay open.

---

Built by [capad](https://github.com/capad-xyz). Questions or feedback: oss@capad.fyi.
