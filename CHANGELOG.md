# Changelog

All notable changes to Grove are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Releases before 0.2.0 predate this file. They exist as the `v0.1.1-alpha`,
`v0.1.2-alpha` and `v0.1.3-alpha` tags.

## [0.2.0] - unreleased

Grove was re-authored. The desktop shell moved from Tauri 2 + Svelte 5 to
Electron 43 + React 19 + TypeScript, and the git engine was ported from Rust to
a headless Node package. The Tauri tree (`src-tauri/`) and the Svelte frontend
(`src/`) are still in the repository as the reference implementation.

Every figure below was measured and recorded in the commit that made the change.

### Added

#### `engine/` — the git engine, in Node

- **`@grove/engine`**, a headless TypeScript package: it spawns the user's `git`
  binary and turns its output into typed repo state. No UI, no Electron, no
  window — an app shell maps its functions onto IPC handlers and that is the
  whole contract.
- Ported from `src-tauri/src/repo` and `src-tauri/src/agent`. The port was cheap
  because `gix` appeared in exactly three places, all `gix::discover`; every real
  operation already shelled out to `git` and parsed stdout. `discover.ts` does
  the same upward walk in-process, so the subprocess count per operation is
  unchanged.
- **Refresh coordinator** with typed events and generation numbers: one
  coordinator per open repo, coalescing invalidations on an 80 ms quiet window
  with a 350 ms ceiling, recomputing only the slices a change touched and
  diffing against the last emitted values before pushing.
- **Watcher event classification** into Refs / Index / Workdir / Worktrees, so a
  ref update recomputes only the graph and a workdir save only status. `.git/index`
  is watched — that is precisely the signal that an agent staged files, and it
  was previously ignored wholesale.
- **Index-lock retry** with 100/300/800/1500 ms backoff, and `--no-optional-locks`
  on every read path, so a background refresh can never collide with an agent
  mid-commit. The lock file is never deleted; the other process owns it.
- **Binary-safe reads**: `fileBytesAt` and `workingFileBytes` return base64
  rather than a UTF-8 decode. `workingFileBytes` refuses anything over 12 MB —
  base64 inflates by a third, and handing a 4K screenshot to the renderer as a
  tens-of-megabytes string is a freeze, not a preview.
- **Files are classified before they are read.** Binary is decided the way git
  decides it, on a NUL byte in the first 8 KB, so asking about a 400 MB video
  costs one small read rather than loading it. Extensions are a hint, not an
  answer. Text is capped at 2 MB and says so when it truncates.
- 45 tests: pure parsers, the watcher classification tests ported verbatim from
  the Rust, coordinator coalescing and change detection, and an integration suite
  driving real `git` against a scratch repository.

#### `app/` — the Electron shell

- Electron main process, preload bridge and React renderer. The 33 Tauri
  commands became `ipcMain.handle` channels (40 today), `invoke()` became a
  `contextBridge` API on `window.grove` (42 methods), and the coordinator's
  `repo-event` became a `webContents` push.
- **Security posture**, because Grove renders diffs and commit messages from
  repositories it did not write and cannot vet — an XSS there in a Node-enabled
  renderer is code execution on a machine holding the user's SSH keys:
  `sandbox`, `contextIsolation`, `nodeIntegration: false`, plus
  `app.enableSandbox()` process-wide; a CSP on every response, widened only for
  Vite's HMR socket in dev; every popup denied and `http(s)` links handed to the
  real browser; `will-navigate` blocked; `webviewTag` off and attach denied; all
  permission requests denied; and the preload hands listeners only the event
  payload, never the `IpcRendererEvent` whose `sender` handle would defeat
  context isolation.
- **`npm run smoke`** — 25 headless end-to-end checks that drive the real path
  (page script → contextBridge → ipcRenderer → ipcMain → engine and back) with
  the window hidden so it never steals focus. It also asserts that `require`,
  `process` and `module` are absent from the renderer. Write checks run against a
  throwaway repository created per run, never the one passed in.
- **Packaging with electron-builder**: `package:dir` for an unpacked build,
  `package` for an installer. NSIS is per-user and lets you choose the install
  directory, since a git client is the kind of tool people want on a specific
  drive and a desktop app has no business demanding admin rights. The
  externalized `@grove/engine` was confirmed to survive packaging: electron-builder
  dereferences the `file:` link and `require('@grove/engine')` resolves inside
  the asar with `chokidar` alongside it, verified by extracting the asar and
  running the resolution from the path the packaged main occupies.
- **An app icon**, generated by `packaging/make-icon.mjs` rather than committed
  as an opaque binary, so the mark stays editable and its reasons stay readable.
  It draws Grove's own commit-graph gutter in `--ink` and `--paper`, no accent,
  because there isn't one.
- **`npm run dev:renderer`** — the renderer as a plain Vite server on
  127.0.0.1:5180, serving fixtures with no bridge, so the UI can be iterated on
  at a browser refresh rather than an Electron relaunch.

#### Interface

- **The Instrument design system** (`app/DESIGN-SYSTEM.md`), authored from three
  directions rather than adopted from a reference, with a reason attached to
  every token. The load-bearing rule: diff green and diff red are the only
  saturated colours in the application, which follows directly from "diffs are
  the content".
- **A palette tied to capad.fyi, inverted.** `--bg` is the portfolio's `--ink`
  `#0b0b0d` exactly and `--text` is its `--paper` `#f1f0ec` exactly; `--muted`
  `#6f6e6a` was lifted to `#7a7975` because contrast does not survive inversion
  (3.85:1 on ink, and in Grove that grey carries SHAs at 9.5–10.5 px). Measured
  against `--bg`: `--text` 17.24:1, `--text-dim` 8.16:1, `--text-faint` 4.51:1,
  `--add` 8.66:1, `--del` 5.86:1. `--text-ghost` does not clear AA and is
  documented as disabled/empty states only.
- **The review surface**: repo bar, worktree strip, commit list with the
  "since you last looked" boundary, diff view, working tree. Layout adapts at
  700 px of *container* width, so an Electron window lays out correctly
  regardless of which display it is on.
- **Commit graph lanes**, computed in a single pass over the topologically
  ordered commits and drawn as one small SVG per row. Greyscale, because the
  graph is structure and a coloured one would compete with the diff. Clamped to
  7 drawn lanes; wider histories still compute correctly.
- **"Since you last looked" now means since the window last had focus.** The
  mark is written on blur and read on focus, and it records working-tree size as
  well as the newest commit, because an agent staging twelve files without
  committing matters as much as one that commits. The count stays frozen while
  the window is focused.
- **Open any repository**: a home surface with recents, a folder browser and
  clone, plus repo switching without a restart. Grove previously only ever
  showed itself — the path was hardcoded.
- **A folder picker with four ways in**: the native chooser, drag-and-drop
  anywhere on the window (the path comes from `webUtils.getPathForFile` in the
  preload, read synchronously because the `DataTransfer` is cleared the moment
  the handler returns), a path field that survives a paste, and breadcrumbs
  where every segment is navigable. Plus one-click home/desktop/documents and
  arrow-key navigation through the list.
- **Staging, unstaging and commit.** Stage all, unstage all, a commit box that
  only exists while something is staged, and a draft button for the
  bring-your-own-agent message. No write refetches: each write pokes the
  coordinator, so the refresh arrives through the same pipeline as a watcher
  event instead of racing it.
- **Spotlight** (`/` or Ctrl/Cmd+K) — one field over files, branches, commits and
  contents. Files and branches match in the renderer against a precomputed index
  carrying pre-lowered path and basename, so a keystroke allocates nothing;
  commits and content go to git, debounced 160 ms. The instant groups render
  *above* the async ones, so late results fill in below what you are already
  looking at and can never shift the highlighted row out from under the keyboard.
  A generation counter drops a slow early query that lands after a faster later
  one. Ranking is basename-first with subsequence matching as the loosest tier.
  Picking a branch or file becomes a lens over the commit list, with a chip
  saying what is filtered; `graph_changed` is ignored while a lens is active.
- **Keyboard navigation**: `j`/`k` and arrows through commits, `Home`/`End` for
  the ends, `Enter` to select when nothing is, `Esc` to clear. Navigation is
  selection-based rather than focus-based, so the diff stays in step with the
  highlighted row. Text fields win — `j` in a commit message is a letter — and
  modified chords are left to the platform.
- **Find in diff** (Ctrl/Cmd+F): Enter and Shift+Enter cycle, Escape closes, and
  a counter reports position and total. Matching is literal and case-insensitive,
  because a diff is code and treating the query as a pattern would surprise
  everyone; hits never overlap, so the visible highlights always agree with the
  count.
- **Images in diffs** instead of "binary files differ": changed images render
  before and after with byte sizes, above the text patch, on a checkerboard so a
  change in transparency is visible, with nearest-neighbour scaling so a small
  icon is inspected rather than blurred. They render through
  `<img src="data:…">` and never as inline markup — an SVG can carry script, and
  inlining one from a repository Grove did not write would hand it the renderer.
- **Rendered Markdown preview**, a per-file toggle that starts closed because
  the diff is still what you came for. The parser is Grove's own and produces a
  token tree that the component renders as React elements, so text from a
  repository can only ever become a text node — injection is impossible by
  construction rather than by filtering, and no HTML string is built anywhere in
  the path. Raw HTML in the source renders as literal text. Links are filtered to
  `http`, `https` and `mailto`; anything else, including relative links, renders
  as plain text.
- **Media previews that stream instead of crossing IPC.** A `grove-file://`
  protocol serves working-tree files straight from the open repository, which is
  what a 50 MB video needs — as base64 it would have been a 67 MB string built
  in main, copied across the boundary, and held in renderer memory. Streaming
  also gives `<video>` real range requests, so seeking works. The handler
  resolves and containment-checks every path against the watched repo root,
  because a scheme that reads off disk is otherwise an arbitrary-read primitive
  handed to the renderer. Images render, video and audio play, text shows, and
  anything else is described rather than decoded — `binary · 46.0 MB · no
  preview available` instead of pages of mojibake.
- **A frameless window.** The OS title bar and Grove's own bar were two strips of
  chrome stacked on each other with one of them empty; the repo bar is the title
  bar now, with system controls overlaid and positioned from the titlebar-area
  env vars so nothing hides under them.
- **A fixture-backed data seam** (`app/src/renderer/src/data/source.ts`): in
  Electron it is the real bridge, in a plain browser it serves fixtures. No
  component may reach for `window.grove` directly.

### Changed

- **Stack.** Tauri 2 + Svelte 5 + a Rust core → Electron 43 + React 19 +
  TypeScript with the git engine in Node. `src-tauri/` and the Svelte `src/`
  are retained, untouched since the port, as the reference implementation.
- **Repository layout.** Work now happens in two npm packages, `engine/` and
  `app/`; the root `package.json` still holds the Tauri-era scripts.
- **The commit list is virtualised.** Each row carries its own SVG gutter, so a
  real repository's history meant thousands of DOM nodes for rows nobody could
  see. Only the rows on screen are mounted, plus a few beyond each edge. Every
  item is exactly one row tall — including the "since you last looked" boundary —
  which is what lets position be arithmetic rather than measurement. Keeping the
  selected row on screen no longer uses `scrollIntoView`, because the row may not
  be mounted, and it scrolls the minimum distance rather than centring.
- **Clicking a working-tree file previews it instead of staging it.** The whole
  row used to be the stage button, so looking at a file and changing the index
  were the same gesture; the costs are not symmetric. Staging moved to its own
  control, which carries `stopPropagation`, keeps `pointer-events: none` while
  hidden, and now appears on keyboard focus as well as hover.
- **Worktree reads run concurrently** (landed on the Rust side before the port
  and carried across): per-worktree status and ahead/behind checks collapse the
  1+2N sequential subprocess wall time to roughly one check. `working_status`
  uses `--untracked-files=normal` so a fresh dependency directory is collapsed
  rather than walked, a batched dirty check replaced one subprocess per recent
  repo at launch, and `git commit-graph write --reachable` runs once per repo per
  session in the background.
- **Electron's stock File/Edit/View/Window menu is dropped on Windows and
  Linux**, since none of it does anything Grove needs. It is kept on macOS, where
  the app menu is what makes the standard edit accelerators work. Devtools keeps
  its F12 / Ctrl+Shift+I binding in dev only, so a packaged build has no key that
  opens an inspector.
- **`buildResources` moved from electron-builder's default `build/` to
  `packaging/`**, because the repo's `.gitignore` ignores `build/` from the
  Svelte era — an icon placed there would silently never be committed.
- **`npm run build` cleans `out/` first.** electron-vite does not, so a renamed
  or removed entry point keeps shipping.

### Fixed

- **The main-process freeze.** The renderer measured exactly 0 CPU while the
  window was unresponsive, which is why the browser harness always felt fine.
  Three separate costs, each measured before and after:
  - Clicking a commit built its diff by asking for one diff per changed file and
    concatenating; each of those internally spawned `rev-parse` plus `diff`, so a
    21-file commit cost roughly 43 subprocesses landing concurrently on the main
    process. `git show --patch --first-parent` does the whole thing in one spawn
    and produces byte-identical output. **913 ms and 43 spawns → 93 ms and 1.**
  - The watcher traversed `.git/objects`, which was **2,934 of 4,232 ignore
    checks — 69% of the work** — for events the classifier has always scored as
    noise. Excluding git internals and build outputs took it from **23% of a core
    to 4%, and RSS from 74 MB to 45 MB**.
  - Coalescing bounded how often a refresh *starts* but not what one costs, so
    under sustained churn the coordinator ran back-to-back `git status` calls
    forever. It now rests for as long as the cycle took, capped at a second,
    which holds it near 50% duty and costs a lone stage click about 150 ms.
  - The file index is no longer fetched on every repo open. `allFiles` walks the
    entire history and most opens never open Spotlight, so it loads on first use.
  - Measured in the packaged app: main process **5.47 cpu-seconds per 10 s while
    lagging, 0 after**, and **421 MB → 286 MB**.
- **Filenames were painted wrong.** `direction: rtl` was used so the ellipsis
  would eat the directory rather than the filename, but a leading bidi-neutral
  character gets reordered under RTL, so `.coderabbit.yaml` rendered as
  `coderabbit.yaml.` and `.claude/` as `/claude.`. The DOM held the right string
  the whole time; only the paint lied. Directory and filename are separate spans
  now, the directory shrinks first and the filename never shrinks.
- **Diff content was unreachable.** `.diff-body` inherited `overflow-x: hidden`
  from the shared scroll helper while its lines are `white-space: pre`, so a
  371 px pane silently swallowed everything past 371 px of a 545 px line. It
  scrolls on both axes now, and the rows sit in a shrink-wrapping wrapper so
  `+`/`−` backgrounds run the full scrolled width.
- **Untracked and no-diff files showed "No textual changes."** `git diff` says
  nothing at all about an untracked file, and image detection reads the
  `diff --git` headers of a patch, so there was nothing to detect; underneath
  that, images only rendered when a commit oid was present, which a working-tree
  preview never has. Working files are previewed from the working tree now, an
  image renders committed-versus-working, and a non-image with no diff renders
  its contents as additions.
- **`workingFile` corrupted binaries**, decoding as UTF-8 and turning a PNG into
  replacement characters. The binary-safe `workingFileBytes` path exists for
  exactly that reason, and smoke now checks that a real PNG survives the round
  trip with its header intact.
- **Previewing an untracked video rendered its raw bytes as thousands of green
  `+` lines, and locked the window while it did.** Both faces of the bug had one
  cause: the preview assumed anything with no diff was a new text file, then read
  it whole and synchronously in the main process — and main owns every IPC reply,
  so a multi-megabyte `readFileSync` stops the entire app rather than merely
  making the preview slow. Files are classified before being read now, and
  nothing unbounded happens on the main thread.
- **The narrow-mode overlay covered the entire app at full width.** The
  container-query `display: none` was declared before `.overlay { display: flex }`,
  so at equal specificity source order won.
- **The POSIX filesystem root was unreachable.** Breadcrumb building stripped
  trailing slashes, which reduced `/` to the empty string and dropped it
  entirely, so on Linux there was no way to navigate to the root.
- **Multi-paragraph commit bodies were truncated in the Node port.**
  `String.split(sep, limit)` discards the remainder where Rust's `splitn` keeps
  it; `splitN` restores the behaviour and a test pins it. Separately, `execFile`
  truncates past `maxBuffer`, so the git wrapper streams into buffers instead.
- **Packaging excluded `*.json` from the engine**, which took its `package.json`
  with it — Node could then not resolve `@grove/engine` at all and the app would
  have died on its first require with no other symptom. Exclusions are specific
  now. A stale `out/PROBE/` from an old debugging session was also shipping
  inside the asar, because electron-vite never clears `out/`.
- **`DESIGN-SYSTEM.md` had silently drifted from `tokens.css`**: the palette was
  re-tied to capad.fyi in the stylesheet while the §3 tables kept quoting the
  previous hexes, so the document contradicted itself. The tables were corrected
  and the agreement is now a test that parses both files and compares colour
  *values* rather than spelling.
- **Fixtures that lied about the flow they were used to check**: the fixture
  source ignored `refspec` (so picking a branch would have looked like it
  worked while changing nothing), fixture history had no parent links for the
  graph to draw, the source ignored writes so staging could not be exercised,
  and untracked entries had no genuinely-empty-diff cases. All corrected.
- **A test-harness bug of my own**: `quiesce()` waited 400 ms for silence while
  the coordinator's cooldown rests up to a second, so it declared the suite quiet
  while a cycle was merely resting and that cycle's events landed in the middle
  of the next test.
- **`.gitignore` now covers every electron-builder output directory**, not just
  `release/` — packaging to a scratch output is the standard way around Windows
  Defender holding a freshly written `app.asar`.

### Known limitations

- **Not released, not signed, not automated.** There is no CI, no code signing
  and no auto-updater. Installers are unsigned, so Windows SmartScreen will warn
  on first run. Releasing is a manual local `npm run package`.
- **Version metadata is inconsistent.** The root `package.json` still says
  `0.1.3` with the Tauri scripts, and `app/package.json` and `engine/package.json`
  say `0.1.0`. Nothing bumps them together.
- **No stash surface.** Stash is in `DESIGN.md`'s v0 scope but no stash operation
  exists in the engine or the interface.
- **No blame UI.** `blame` is implemented in the engine and exposed on the
  bridge, but nothing in the renderer consumes it.
- **No inline editing.** The Monaco quick-edit pane from `DESIGN.md` is not
  built, and there is no path that writes file contents.
- **The worktree strip is read-only.** It lists branch, dirty state and
  ahead/behind. There is no add, remove, prune, or switch.
- **The agent layer ships one backend.** A local CLI, defaulting to `claude -p`
  with the staged diff piped to stdin, plus a manual no-op. The API-key backend
  described in `DESIGN.md` does not exist, the command is not configurable from
  the interface, and `prDraft` is part of the interface with no implementation
  beyond the no-op.
- **The commit list loads a fixed 200 commits.** There is no pagination, and no
  "load more".
- **No settings surface**, which is why the opt-in `core.fsmonitor` /
  untracked-cache repo setting is still deferred: it mutates the user's repo
  config and should not happen without explicit consent.
- **No typed error surface across IPC.** The engine has `GitError` and a lock
  check, but rejections cross the bridge as messages, so the renderer cannot
  distinguish "locked" from "not found" and render them differently.
- **Only the Windows path is exercised.** electron-builder is configured for a
  macOS dmg and a Linux AppImage, but builds and measurements in this release
  were all made on Windows.
- **`git` must be on `PATH` at runtime**, not just at build time. Every
  operation shells out to it.
