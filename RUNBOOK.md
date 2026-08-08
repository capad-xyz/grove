# Grove Runbook

Grove is a desktop Git companion meant to sit beside an AI coding editor and give
you the commit graph, diff review, status and worktree surfaces those editors
treat as an afterthought. It is a local desktop app: no server, no database, no
accounts, no network backend.

**It is now Electron + React + TypeScript.** The Tauri 2 + Svelte 5 shell that
this runbook used to document is still in the tree as the reference
implementation, but it is not what you build. Status is pre-alpha and
single-developer, on branch `reauthor`.

This is the operational layer: how to install, run, test, build and package it on
Windows, and what a real release would still need. For the product thesis read
[DESIGN.md](DESIGN.md); for the shell's security posture and internals read
[app/README.md](app/README.md); for the git engine read
[engine/README.md](engine/README.md).

> Note on the sibling docs: `README.md` and `DESIGN.md` at the repo root still
> describe the Tauri shell (the README badge still says "Tauri + Svelte"). They
> have not been re-authored yet. Where they disagree with this file about how to
> build or run Grove, this file is the current one.

## The three trees

| Path | Package | Version | What it is |
|---|---|---|---|
| `engine/` | `@grove/engine` | 0.1.0 | The git engine, headless. Spawns the user's `git` and parses it. ESM (`"type": "module"`). Phase 1 of the move off Tauri. |
| `app/` | `@grove/app` | 0.1.0 | The Electron shell: main process, preload bridge, renderer. Phase 3. Deliberately has **no** `"type"` field — see the CommonJS-preload trap below. |
| `src/` + `src-tauri/` | `grove` (root `package.json`) | 0.1.3 | The legacy Tauri 2 + Svelte 5 app. Still builds; kept as the reference implementation until the React frontend reaches parity. |

`app` depends on `engine` through `"@grove/engine": "file:../engine"`, so npm
symlinks it and electron-builder dereferences the link when packing. There are no
npm workspaces — each package installs separately, engine first.

Three version numbers that are not related to each other, and no rule saying
which one a release is named after. See "Not ready for public release".

## Prerequisites

Verified on the author's machine: Windows 11, PowerShell primary, Git Bash
available.

1. **Node.js and npm.** `engine/package.json` declares `"node": ">=22.18"`, which
   is the floor for running TypeScript tests unflagged through Node's type
   stripping. Verified working here on **Node v24.16.0 / npm 11.13.0**. `app`
   declares no `engines` field; follow the engine's floor.

```powershell
winget install --id OpenJS.NodeJS.LTS
```

2. **Git CLI on PATH.** A runtime requirement, not just a build one. The engine
   spawns the user's `git` binary for every operation — `engine/src/git.ts` is
   the only place that spawns it, and everything else goes through there.
   Verified here: `git version 2.47.1.windows.1`.

```powershell
winget install --id Git.Git
```

3. Optional, only for the "generate commit message" feature: an agent CLI on
   PATH. `engine/src/agent.ts` defaults to `claude -p` and pipes the staged diff
   to its stdin; on Windows it goes through `cmd /C` so npm-installed shims
   (`claude.cmd`) resolve. Any CLI that reads a prompt on stdin works. Nothing
   else depends on it, and the feature degrades to an error message when the
   command is missing.

**Not needed for the Electron app: Rust, rustup, MSVC C++ build tools, WebView2.**
Those are prerequisites for the legacy Tauri shell only (see the last section).
Also not needed: WSL, Docker, any database.

Disk: `app/node_modules` is the heavy item (Electron ships a full Chromium).
Budget a couple of GB for `app/node_modules` + `out/` + `release/`. The 11 GB
`src-tauri/target` cache only grows if you build the legacy shell.

## First-time setup

Order matters: `app`'s `predev`/`prebuild` hooks shell into `engine` and run its
build, so the engine's own devDependencies (TypeScript) must be installed first.

1. Clone and enter the repo.

```bash
git clone https://github.com/capad-xyz/grove.git
```

2. Install the engine.

```bash
npm --prefix engine install
```

`chokidar` lands in `engine/node_modules`, not in `app/node_modules` — the app
reaches it through the symlink. Do not be alarmed by its absence over there.

3. Install the app.

```bash
npm --prefix app install
```

4. **Verify Electron's binary actually downloaded.** This step exists because it
   sometimes silently does not — see the traps section.

```bash
node -e "console.log(require('fs').readFileSync('app/node_modules/electron/dist/version','utf8'))"
```

Expected: a version string, `43.3.0` at time of writing. If the file is missing,
run `node node_modules/electron/install.js` from inside `app/`.

5. No environment file step. There is no `.env`, no `.env.example`, and nothing
   project-specific is read from the environment. The one variable that matters,
   `ELECTRON_RENDERER_URL`, is set by `electron-vite dev` itself and is how the
   main process knows it is in dev mode (`app/src/main/index.ts`).

6. No database, no seed step, no secrets. **There are no credentials in this
   repository and none are required to build, run, test or package it.**

## Local dev loop

All commands below are written from the repo root using `npm --prefix`. Run them
from inside `app/` or `engine/` without the prefix if you prefer.

**The normal loop — full Electron app with renderer HMR.**

```bash
npm --prefix app run dev
```

`predev` builds the engine first (`npm --prefix ../engine run build`), then
`electron-vite dev` starts a Vite dev server for the renderer, builds main and
preload, and launches Electron pointed at that server. Renderer edits hot-reload.
Edits to `src/main/**` or `src/preload/**` restart the Electron process.

`electron.vite.config.ts` does not pin a port, so the renderer dev server takes
electron-vite's default and hands its URL to the main process as
`ELECTRON_RENDERER_URL`. The main process keys every dev-only relaxation off that
variable rather than off `NODE_ENV`, so none of it can leak into a packaged
build: the CSP's `'unsafe-inline'` for React Refresh, the widened `connect-src`
for the HMR websocket, and the F12 / Ctrl+Shift+I devtools accelerator all exist
only when `ELECTRON_RENDERER_URL` is set.

**Engine edits do not hot-reload.** The main bundle keeps `@grove/engine`
external and `require`s it at runtime from `engine/dist/`. After changing
`engine/src/**`, rebuild the engine (`npm --prefix engine run build`) and restart
the app, or just restart `npm run dev`, which rebuilds it via `predev`.

Two things about the window itself, both deliberate:

- **It is frameless.** `titleBarStyle: 'hidden'`, with `titleBarOverlay` (colour
  `#0b0b0d`, symbol `#9a9a97`, height 34) on Windows and Linux and
  `trafficLightPosition` on macOS. Grove's repo bar *is* the title bar. If you
  are changing the top strip of the UI, the system controls are overlaid on it
  and you must leave room for them.
- **`grove-file://` streams working-tree files to the renderer.** Registered as a
  privileged scheme at module scope in `app/src/main/index.ts` (it has to happen
  before `app` is ready), handled after ready via `protocol.handle`. Media cannot
  go through IPC as base64 — a 50MB video becomes a 67MB string copied across the
  boundary — so the scheme streams from disk through `net.fetch`, which gives
  `<video>` real range requests and therefore seeking. It is **confined to the
  currently-open repository**: the handler reads `watchedRoot()` from
  `app/src/main/ipc.ts`, resolves the request path against it, and rejects
  anything that is not contained (403), plus 403 when no repository is open.
  `..` cannot climb out because `resolve` collapses it before the prefix check.
  The CSP allows the scheme in `img-src` and `media-src` only. **If you touch
  that handler, you are touching the one place that turns a sandboxed renderer
  into a disk reader.** Keep the containment check.

Expect Electron to log every rejected `ipcMain.handle` to stderr. Errors the
renderer handles correctly — a path that is not a repository, say — still show up
there. That is not a failure.

## Browser-only renderer harness

```bash
npm --prefix app run dev:renderer
```

Serves the renderer in a plain browser at **http://127.0.0.1:5180** with no
Electron around it. `window.grove` is absent, so `src/renderer/src/data/source.ts`
falls back to fixtures. This is the fast loop for design work: a browser refresh
instead of an Electron relaunch. `.claude/launch.json` has this as the
`grove-renderer` configuration with `autoPort: false`.

The port is pinned with `strictPort: true` and bound to `127.0.0.1` rather than
`::1`, both on purpose — see the Windows port trap below.

Two harness-specific traps, both documented in `app/README.md`:

- **A hidden browser tab gets its timers clamped by Chrome.** A 40ms
  `setTimeout` was measured at 464ms. Poll for DOM changes when testing here
  rather than sleeping, or you will read stale state and conclude the app is
  broken.
- **Editing `data/source.ts` leaves HMR holding a stale module instance.** Hard
  reload before debugging anything that looks dead.

## Tests and checks

Nothing in this repo runs automatically. There is **no CI** — no `.github/`
directory, no workflows, no required status checks. Pushing triggers nothing.
Everything below is something a human runs.

**Engine.**

```bash
npm --prefix engine run check
```

`check` is `typecheck && test`: `tsc --noEmit` over everything including tests,
then `node --test "src/**/*.test.ts"`. Tests run straight off the TypeScript
source via Node's type stripping — no build step. 5 test files; the engine README
puts the suite at 44 tests: pure-parser tests, watcher classification tests
ported verbatim from the Rust, coordinator tests covering coalescing and change
detection, and an integration suite that drives real `git` against a scratch
repository.

**Renderer and types.**

```bash
npm --prefix app run check
```

`check` is `typecheck && test`.

- `typecheck` runs `tsc --noEmit` over **three** configs: `tsconfig.node.json`
  (main, preload, shared, and the electron-vite config), `tsconfig.web.json`
  (renderer), and `tsconfig.test.json`. Note that `app/tsconfig.json` only
  references the first two — the test config is picked up by the script, not by
  the solution file, so `tsc -b` alone would miss it. Keeping this green is what
  makes the preload's `GroveApi` typing load-bearing: a missing or misnamed
  bridge method becomes a compile error.
- `test` is `node --test "src/renderer/src/**/*.test.ts"` — 9 test files, all
  pure renderer logic under `src/renderer/src/data/` and `src/renderer/src/styles/`.
  It does **not** touch the engine and does **not** start Electron.

**The bridge smoke check** — the one that would matter for CI.

```bash
npm --prefix app run smoke
```

`electron-vite build && electron . --smoke`. It launches Electron with the window
**hidden** (so it never steals focus, which matters when the author's real Grove
is open) and drives the *real* path: page script calls `window.grove.*`, which
crosses contextBridge → ipcRenderer → ipcMain → engine and back. It exits
non-zero on any failure, printing `PASS`/`FAIL` per check.

What it covers, from `app/src/main/smoke.ts`:

- The bridge is exposed at all, and the security posture holds — `window.require`,
  `window.process` and `window.module` are all absent.
- Read paths against Grove's own repository: `openRepo`, `commitGraph` (including
  that a refspec actually narrows the result), `branches`, `workingStatus`,
  `worktrees`, `commitDetail`, `fileHistory`, `allFiles`.
- Spotlight's git-backed tiers: `searchCommits` and `grepRepo`, each checked both
  for hits and for the miss case — `git grep` exits non-zero on no matches, and
  that must read as "no hits", not as an error.
- Errors propagate as messages, not as opaque rejections.
- `workingFileBytes` round-trips a real PNG (`app/packaging/icon.png`) with its
  magic bytes intact, and returns `null` for a missing file.
- `watchRepo` emits live coordinator events, with a 20s ceiling.
- **Write checks run against a throwaway repo in the temp directory**, never the
  one you pass in: stage, unstage, stage-all, commit, and a clean-after-commit
  assertion. If the scratch repo cannot be created the write checks are skipped
  with a warning rather than failing.

`--smoke` with no path targets Grove's own repository (three levels up from the
built main bundle). `--smoke=<path>` points it elsewhere; the read checks assume
a repo that has `DESIGN.md` and commits mentioning "Engine", so a foreign repo
will report failures that are not bugs.

Two things `smoke` does *not* do, both visible in `package.json`: it calls
`electron-vite build` directly rather than `npm run build`, so it **does not
rebuild the engine** (no `prebuild` hook fires) and **does not clean `out/`**.
Run `npm --prefix app run build` first if the engine changed or if you have
renamed an entry point.

## Building bundles

```bash
npm --prefix app run build
```

`prebuild` builds the engine (`tsc -p tsconfig.build.json` → `engine/dist/`),
then `npm run clean && electron-vite build`. Output is `app/out/main/`,
`app/out/preload/`, `app/out/renderer/`. `app/package.json`'s `"main"` points at
`./out/main/index.js`.

`clean` (`node -e "require('fs').rmSync('out',…)"`) exists because electron-vite
does not clean, so a renamed or removed entry point keeps shipping. A stale
`out/PROBE/` from a debugging session made it into a package before this was
added.

Run the built app without packaging it:

```bash
npm --prefix app start
```

That is `electron-vite preview` — the production bundle in a real Electron
window, no dev server, no HMR, production CSP. This is the honest check of
anything that behaves differently outside dev.

Two structural facts about the bundle worth knowing before you change the config:

- **The preload is CommonJS and must stay that way** — see the traps section.
- **`@grove/engine` stays external in the main bundle.** It is left as a runtime
  `require`, which works because Electron 43 ships Node 22 and supports
  `require(esm)` for modules without top-level await, and the engine has none.
  This is settled and it packages correctly; the engine does not need a CJS
  build.

## Packaging an installer

Config is `app/electron-builder.yml`, kept as YAML rather than a block in
`package.json` so the decisions can carry their reasons. `appId: fyi.capad.grove`,
`productName: Grove`, `asar: true`, `directories.output: release`,
`directories.buildResources: packaging`.

`buildResources` is `packaging/`, not electron-builder's default `build/`,
because the repo's `.gitignore` ignores `build/` (it was the old Svelte output) —
an icon placed there would silently never be committed, and packaged builds
elsewhere would lose it. The icon exists: `app/packaging/icon.png`, 512×512,
generated by the committed `app/packaging/make-icon.mjs` (`node
packaging/make-icon.mjs` regenerates it). `app/README.md` still says there is no
icon; that note is stale.

**Unpacked build, no installer.** Faster, and enough to check that the app runs
outside the dev harness.

```bash
npm --prefix app run package:dir
```

`npm run build && electron-builder --dir` → `app/release/win-unpacked/`. This has
been run on the author's machine; that directory (and a `release-app/` from an
output-override run) exists locally.

**Full installer for the host platform.**

```bash
npm --prefix app run package
```

`npm run build && electron-builder`. On Windows this produces the NSIS installer
at `app/release/Grove-0.1.0-win-x64.exe`, from `artifactName:
${productName}-${version}-win-${arch}.${ext}` and the version in
`app/package.json`. **This has never been run.** No installer has been produced
from the Electron codebase.

The NSIS settings are chosen deliberately: `oneClick: false`, `perMachine: false`,
`allowToChangeInstallationDirectory: true` — a git client is the kind of tool
people want on a specific drive, and installing per-user avoids demanding admin
rights for a desktop app.

What goes in the package (`files`): `out/**/*` and `package.json`, minus
`**/*.map` (source maps roughly double the payload and are useless in a shipped
build), minus the engine's `src/`, `tsconfig*.json` and `README.md`. Production
dependencies are resolved and copied by electron-builder itself, which is what
carries `@grove/engine` in.

**Do not "tidy" those exclusions into `*.json`.** It would take the engine's
`package.json` with it, Node could then no longer resolve `@grove/engine`, and
the packaged app dies on its first require with no other symptom. The exclusions
are specific for exactly this reason.

`release*/` is gitignored, so `release/`, `release-app/` and the `release-check`
scratch output from the EBUSY workaround are all untracked.

**macOS and Linux are configured but have never been built or run.**
`mac: { category: public.app-category.developer-tools, target: [dmg] }` and
`linux: { category: Development, target: [AppImage] }`. electron-builder cannot
produce a usable signed macOS build from Windows; a dmg needs a macOS host, and
an AppImage realistically needs a Linux host or container. Treat both as
untested configuration, not as supported targets.

## What a real release would require

None of this is done. In rough order:

1. **Decide what the version number is.** Right now `engine` is 0.1.0, `app` is
   0.1.0, and the root Tauri package is 0.1.3. electron-builder takes the
   installer's version from `app/package.json` alone. Nothing syncs, validates or
   bumps any of them.
2. **Code signing.** There is no `win.certificateSubjectName`, no
   `certificateFile`, no signing block of any kind in `electron-builder.yml`, and
   no macOS `identity`/notarization config. Without a certificate, SmartScreen
   warns on every download until reputation accrues, which for an unsigned binary
   is effectively never.
3. **Auto-update.** No `publish` block, no update feed, no `electron-updater`
   dependency. Shipping a fix today means every user manually downloading a new
   installer, and there is no channel to tell them one exists.
4. **Actually build and run the macOS and Linux targets** on their own hardware,
   including whether the frameless window and `titleBarOverlay` behave (macOS
   takes the `trafficLightPosition` branch instead), and whether the
   `grove-file://` scheme and the `git` spawn paths hold up.
5. **CI.** There is no `.github/`. At minimum: `npm --prefix engine run check`,
   `npm --prefix app run check`, and `npm --prefix app run smoke` on every push —
   smoke is the one that proves the bridge, and it runs headless with the window
   hidden precisely so it can live in CI.
6. **GPL-3.0-or-later obligations.** `LICENSE` is at the repo root and
   `electron-builder.yml` carries the copyright line, but a distributed binary
   must ship the licence text and a way to get the corresponding source. Nothing
   currently packs `LICENSE` into the installer.
7. **Somewhere to put the artifacts**, and a decision about what a "release"
   means — GitHub Releases, a tag convention, and release notes. None exist.
8. **A rollback story.** Today it is "reinstall the previous installer", and
   there is no previous installer.

## Known traps

Verified against `app/README.md`, `app/vite.renderer.config.ts`,
`app/electron.vite.config.ts` and the installed dependency metadata.

- **`EBUSY: resource busy or locked` on `app.asar` when packaging.** This is
  Windows Defender still scanning the file electron-builder just handed it, not a
  corrupt build and not another process of yours. **It hits the first packaging
  attempt frequently; a plain retry usually succeeds.** If you are iterating and
  do not want to wait, build to a scratch output instead:

```bash
npm --prefix app run package -- -c.directories.output=release-check
```

  (`release-check` is covered by the `release*/` ignore rule, so it stays
  untracked.)

- **Electron's binary may not download on install.** `npm install` completes, but
  the postinstall that fetches the Electron binary did not, and the first run
  fails with `Error: Electron uninstall`. Fix it from inside `app/`:

```bash
node node_modules/electron/install.js
```

- **Vite must stay on 7.** `electron-vite@5.0.0` declares
  `"vite": "^5.0.0 || ^6.0.0 || ^7.0.0"` as a peer dependency, so 7 is the
  ceiling — verified in `app/node_modules/electron-vite/package.json`, not in the
  README, which only mentions Vite 7 in passing. `app/package.json` pins
  `"vite": "^7.3.6"`. A caret bump to 8 puts you outside the peer range and into
  electron-vite's untested territory; wait for electron-vite to widen it. Related
  behaviour already bitten under Vite 7: electron-vite's externalization ignores
  `ssr.noExternal`, `resolve.alias` and `rollupOptions.external` overrides, which
  is why `@grove/engine` is left external rather than bundled.

- **The preload must stay CommonJS.** A sandboxed preload is loaded in a
  restricted context with no ESM loader, so it cannot be an ES module. This is
  mandatory, not a preference. Two things enforce it, and both must stay:
  `electron.vite.config.ts` forces `output: { format: 'cjs' }` for the preload
  build, and `app/package.json` has **no `"type"` field**, so a bare `.js` file
  there means CommonJS. Adding `"type": "module"` to `app/package.json` breaks
  the preload, and the symptom is a renderer with no bridge rather than an
  obvious error.

- **Windows reserves TCP port ranges, and a bind inside one fails with `EACCES`
  that reads like a permissions problem but is not.** Hyper-V / WinNAT reserves
  several ranges. Check before picking a port:

```powershell
netsh int ipv4 show excludedportrange protocol=tcp
```

  **The ranges are not stable across reboots.** `app/README.md` records Vite's
  preview default 4173 sitting inside a reserved 4147–4246; the old Tauri runbook
  records 1375–1474, which is why the Svelte dev server moved off 1420 to 7420.
  Neither range is present on this machine today — the current list is entirely
  different. So do not trust any range written down anywhere, including here: run
  the command. `dev:renderer` pins **5180** and binds `127.0.0.1` rather than
  `::1` for this reason, with `strictPort: true` so a collision fails loudly
  instead of silently moving.

- **`npm run smoke` skips the engine build and skips the clean.** It runs
  `electron-vite build` directly, not `npm run build`, so no `prebuild` hook
  fires. Stale `engine/dist/` means you are smoke-testing old engine code.

- **Engine changes need an engine rebuild even in dev.** `@grove/engine` is
  external to the main bundle and `require`d at runtime from `engine/dist/`.
  Nothing watches it.

- **The browser harness tab is hidden, so Chrome clamps its timers** (40ms
  measured at 464ms). Poll for DOM changes rather than sleeping. Editing
  `data/source.ts` also leaves HMR holding a stale module instance — hard reload
  first.

- **Electron logs every rejected `ipcMain.handle` to stderr.** Expected errors
  appear there even when the renderer handled them correctly.

- **`git status` lies about `src-tauri/Cargo.toml`.** `core.autocrlf=true` is set
  globally and there is no `.gitattributes`, so it shows as modified with an
  empty `git diff`. Harmless. Do not `git checkout` it reflexively and do not
  sweep it into an unrelated commit.

## Not ready for public release

Stated plainly so nobody has to rediscover it:

- **Nothing has ever been shipped in the Electron form.** No installer has been
  produced. `package:dir` has been run; `package` has not.
- **No code signing.** The installer would be unsigned. Windows SmartScreen will
  show "Windows protected your PC" to every downloader, and there is no
  reputation to accumulate against without a certificate. macOS would refuse an
  unsigned, un-notarized app outright.
- **No auto-update.** No publish target, no update feed, no `electron-updater`.
  A shipped bug stays shipped until each user manually finds and installs a
  replacement.
- **macOS and Linux are configuration only.** `dmg` and `AppImage` targets are
  declared and have never been built or run. Assume they are broken until proven
  otherwise; they cannot be validated from the Windows dev machine.
- **Version numbering is unresolved.** Three packages carry three unrelated
  versions and nothing reconciles them.
- **No CI, so nothing is verified on anything but the author's machine**, and no
  release ever gets an automatic build.
- **The renderer is a wiring harness, not a design.** `app/README.md` says it
  outright: phase 4 deletes it and replaces it with the real design-first React
  interface.
- **GPL-3.0-or-later source-offer obligations are not wired into packaging.**

Treat any build produced today as a developer artifact for the author's own
machine.

## Committing

- **Configured git identity for this repo**: `user.name` is `capad.fyi`,
  `user.email` is `capad.xyz@gmail.com`, set per-repo. This is a personal
  project; do not push work-account commits to it.
- **Hooks: none.** `.git/hooks/` contains only the stock `.sample` files. No
  husky, no lint-staged, no `prepare` script. Nothing runs on commit, so nothing
  can block one, and there is never a reason to reach for `--no-verify`.
- **Default / integration branch: `main`. Current branch: `reauthor`**, which now
  tracks `origin/reauthor`. Check position with `git status -sb` rather than
  trusting a number written here.
- **Branch naming** is loose: mostly `main` plus occasional topic branches like
  `chore/contact-and-readme` (`type/short-kebab-description`); `reauthor` is a
  bare noun.
- **Commit message style**: an area prefix and a sentence-style imperative
  summary, sometimes with a semicolon-joined pair of changes — `Engine: lock
  hardening on the git boundary`, `UI: preview working-tree files that git has no
  diff for`, `Perf: virtualise the commit list`. Chores use conventional-commit
  prefixes (`chore: …`). Bodies, when present, are `-` bullet lists covering what
  changed and why, often ending with a note about what was deliberately deferred.
- **Do not add `Co-Authored-By` trailers.** Some older commits carry them; new
  commits should not.
- The working tree usually has unrelated in-progress items — the phantom-CRLF
  `src-tauri/Cargo.toml`, plus untracked `.claude/`, `.coderabbit.yaml`,
  `AGENTS.md` and `docs/`. **Stage files explicitly by path. Never `git add -A`,
  `git add .`, or `git commit -a` in this repo.**

```bash
git add <specific-path>
```

```bash
git commit -m "Area: what changed and why"
```

```bash
git push origin HEAD
```

## The legacy Tauri shell

`src/` (Svelte 5) and `src-tauri/` (Rust) are still in the tree and still build.
They stay as the reference implementation until the React frontend reaches
parity, and the root `package.json` still carries their scripts — `npm run dev`,
`npm run build`, `npm run preview`, `npm run tauri`.

Building it needs the toolchain the Electron app does not: **MSVC C++ build tools**
(Rust's `x86_64-pc-windows-msvc` target links with `link.exe`, which ships with
Visual Studio Build Tools, not with rustup), **rustup with the MSVC toolchain**
(not `-gnu`), and the **WebView2 runtime** (preinstalled on Windows 11). A cold
Rust build takes 8–14 minutes and `src-tauri/target` reaches ~11 GB. Do not
delete that directory casually.

```bash
npm run tauri dev
```

Its Vite dev server is pinned to **7420** in two places that must match:
`vite.config.js` (`server.port`) and `src-tauri/tauri.conf.json` (`build.devUrl`).
`.claude/launch.json` still carries `tauri-dev` and `vite` configurations on 7420
and a `vite-preview` on 5181, alongside the current `grove-renderer` on 5180.

If you are not deliberately working on the old shell, ignore all of this.

## Project map

```
Grove/
  RUNBOOK.md            This file
  README.md             Public pitch — still describes the Tauri shell
  DESIGN.md             Thesis, locked decisions, v0 scope — pre-Electron
  AGENTS.md             Untracked; working agreements for AI agents on this repo
  LICENSE               GPL-3.0-or-later
  .claude/launch.json   Untracked; run configurations and their pinned ports

  engine/               @grove/engine — the git engine, headless, ESM
    README.md           Port rationale and the behaviour carried over from Rust
    src/git.ts          The only place that spawns git. Lock retry, --no-optional-locks, windowsHide
    src/discover.ts     Repository discovery (replaces gix::discover)
    src/parse.ts        Pure parsers for git output; test without a repo
    src/read.ts         graph, detail, diff, blame, status, worktrees, search
    src/write.ts        stage, unstage, commit, clone
    src/watch.ts        Filesystem watcher; classifies events into invalidation bits
    src/service.ts      Refresh coordinator: coalescing, generations, change detection
    src/agent.ts        BYO-agent: local CLI backend (defaults to `claude -p`) + Manual
    src/*.test.ts       5 test files, 44 tests
    dist/               tsc output; gitignored; what the app requires at runtime

  app/                  @grove/app — the Electron shell
    README.md           Security posture and notes for whoever touches it next
    DESIGN-SYSTEM.md    Visual and interaction decisions
    electron.vite.config.ts  main / preload / renderer builds; forces CJS preload
    vite.renderer.config.ts  Browser-only harness; 127.0.0.1:5180, strictPort
    electron-builder.yml     Packaging config, with its reasons in comments
    packaging/icon.png       512x512 app icon
    packaging/make-icon.mjs  Committed generator for the icon
    tsconfig.{node,web,test}.json  The three configs `npm run typecheck` covers
    src/main/index.ts   Window lifecycle, CSP, frameless titlebar, grove-file:// handler
    src/main/ipc.ts     The 33 handlers; owns watchedRoot(), the protocol's fence
    src/main/smoke.ts   Headless end-to-end check of the bridge
    src/preload/index.ts contextBridge — the only thing the renderer can reach
    src/shared/ipc.ts   Channel names + the GroveApi contract
    src/renderer/       Phase 3 harness (temporary); 9 test files under src/data + src/styles
    out/                electron-vite bundle; gitignored
    release*/           electron-builder output; gitignored

  src/                  Legacy Svelte 5 frontend
  src-tauri/            Legacy Rust core + Tauri config; target/ is ~11 GB
```
