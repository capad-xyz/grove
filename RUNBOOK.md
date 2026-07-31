# Grove Runbook

Grove is a desktop Git companion (Tauri 2 + Svelte 5 + a Rust core) meant to sit
beside an AI coding editor and give you the commit graph, diff review, status and
worktree surfaces those editors treat as an afterthought. It is a local desktop
app: no server, no database, no accounts, no network backend. Status is pre-alpha
and single-developer; the app builds and runs, and the current branch `reauthor`
is mid-way through an engine restructure. This runbook is the operational layer:
how to get it building, running, committed and packaged on Windows. For the
product thesis and architecture decisions read [DESIGN.md](DESIGN.md); for the
public pitch read [README.md](README.md).

## Stack

- Desktop shell: **Tauri 2**. Confirmed three ways: `tauri = { version = "2" }`
  in `src-tauri/Cargo.toml`, `@tauri-apps/cli ^2.11.3` and `@tauri-apps/api
  ^2.11.1` in `package.json`, and `"$schema":
  "https://schema.tauri.app/config/2"` in `src-tauri/tauri.conf.json`. Tauri 1
  guides do not apply: config keys, the permissions model and the CLI all differ.
- Frontend: **Svelte 5** (`svelte ^5.56.4`) with `@sveltejs/vite-plugin-svelte
  ^5.1.1`. Uses Svelte 5 runes (`src/state/repo.svelte.js`, `src/diffwrap.svelte.js`).
- Bundler / dev server: **Vite 6** (`vite ^6.4.3`), config in `vite.config.js`.
- Language on the frontend: **plain JavaScript, not TypeScript**. `jsconfig.json`
  sets `checkJs: true`, so editors type-check JS via JSDoc, but there is no `tsc`
  step and no TypeScript dependency.
- Rust core: edition **2021** (`src-tauri/Cargo.toml`). No `rust-toolchain.toml`
  is pinned, so it builds on whatever `rustup` default you have. Verified working
  on this machine with `rustc 1.96.0` / `cargo 1.96.0`, host triple
  `x86_64-pc-windows-msvc`.
- Rust crate layout: package `grove`, library `grove_lib`, crate types
  `staticlib`/`cdylib`/`rlib` (the mobile-friendly Tauri 2 layout). `main.rs` is a
  two-line shim that calls `grove_lib::run()`.
- Key Rust deps: `gix 0.85.0` (fast reads), `notify 8.2.0` (filesystem watch),
  `tokio 1` (features `sync`, `time`), `anyhow 1.0.102`, `serde` + `serde_json`.
- Git engine: hybrid by design. `gix` for reads, the user's installed **`git` CLI**
  shelled out for writes (`src-tauri/src/repo/write.rs`). `git` on PATH is a
  runtime requirement, not just a build one.
- Package manager: **npm**, `package-lock.json` present (`lockfileVersion: 3`).
  Rust side has `src-tauri/Cargo.lock` committed.
- Node: no `engines` field, no `.nvmrc`, no `.npmrc` anywhere in the repo.
  README asks for Node 18+, recommends 22.12+. Verified working here on
  **Node v24.16.0 / npm 11.13.0**.
- Database: none. Key services: none. Nothing talks to a network API.
- App identity: productName `Grove`, bundle identifier `com.capad.grove`,
  version `0.1.3` (kept in sync across `package.json`, `src-tauri/Cargo.toml`
  and `src-tauri/tauri.conf.json`).

## Prerequisites

The author's machine is Windows 11, PowerShell primary, Git Bash available. All
five items below were verified present on that machine; versions listed are what
is actually installed and known-good.

1. **MSVC C++ build tools.** This is the single biggest cause of a failed first
   Tauri build on Windows. Rust's `x86_64-pc-windows-msvc` target links with
   `link.exe`, which ships with Visual Studio Build Tools, not with rustup.
   Verified here: `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Tools\MSVC\14.42.34433\bin\Hostx64\x64\link.exe`.
   Install via the Visual Studio Installer, workload **"Desktop development with
   C++"** (the "MSVC v143 build tools" plus "Windows 11 SDK" components are the
   parts that matter).

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

2. **WebView2 runtime.** Tauri renders the UI in the Edge WebView2 control. It is
   preinstalled on Windows 11, so on this machine nothing was needed. Verified
   installed: version `150.0.4078.105`. On Windows 10 or a stripped image you must
   install the Evergreen runtime yourself, otherwise the app process starts but
   the window is blank.

```powershell
winget install --id Microsoft.EdgeWebView2Runtime
```

3. **Rust toolchain via rustup, MSVC flavour.** The target must be
   `x86_64-pc-windows-msvc`, NOT `...-windows-gnu`. Verified here: default host
   `x86_64-pc-windows-msvc`, single installed toolchain
   `stable-x86_64-pc-windows-msvc`, installed target `x86_64-pc-windows-msvc`.

```powershell
winget install --id Rustlang.Rustup
```

Confirm the toolchain is the MSVC one before building:

```powershell
rustup show
```

4. **Node.js 18+ (22.12+ recommended, 24.x verified working) and npm.**

```powershell
winget install --id OpenJS.NodeJS.LTS
```

5. **Git CLI on PATH.** Required at runtime, not only for cloning: every write
   path (stage, unstage, commit) and several reads shell out to `git`. Verified
   here: `git version 2.47.1.windows.1`.

```powershell
winget install --id Git.Git
```

Not needed: WSL, Docker Desktop, Android SDK, any database server. Grove builds
natively on Windows.

Optional, only for the "generate commit message" feature: a `claude` CLI on PATH.
`src-tauri/src/agent/mod.rs` defaults to running `claude -p` and piping the staged
diff to its stdin. Nothing else in the app depends on it, and the feature degrades
to an error message if the command is missing.

Disk: budget roughly **12 GB free**. The Rust build cache alone
(`src-tauri/target`) is **11 GB** on this machine; `node_modules` is 65 MB.

## First-time setup

1. Clone the repo.

```bash
git clone https://github.com/capad-xyz/grove.git
```

2. Enter it.

```bash
cd grove
```

3. Install frontend dependencies. Use `npm ci` for an exact lockfile install.

```bash
npm ci
```

Success signal: npm prints `added <N> packages` and exits 0, and a
`node_modules/` directory plus `node_modules/.bin/vite` now exist. The lockfile
holds 116 package entries, but the installed count is lower (about 100) because
the platform-specific rollup and esbuild binaries for other operating systems are
skipped. There are no postinstall scripts in this project, so `--ignore-scripts`
is not a concern here.

4. No environment file step. There is no `.env`, no `.env.example`, and nothing
   reads a project-specific env var. Skip straight to building.

5. No database and no seed step. Grove reads whatever Git repository you point it
   at, at runtime.

6. Do the first full build. **This is the slow one: expect 10+ minutes** and do
   not interrupt it.

```bash
npm run tauri dev
```

Success signal, in this order: Vite prints `VITE v6.4.3 ready in ~1.7s` and
`Local: http://localhost:7420/`; then `Compiling grove v0.1.3`; then a
`Building [===> ] 475/477` progress bar that sits there for several minutes;
then `Finished \`dev\` profile [unoptimized + debuginfo] target(s)`; then
`Running \`target\debug\grove.exe\`` and a native window titled "Grove" opens at
1100x720. A wall of `[vite-plugin-svelte] ... a11y_...` warnings after the window
appears is normal and is not a failure (see Gotchas).

Verified timings from the checked-in build logs on this machine: a cold build
took **8m 29s** (`src-tauri/_build.log`), and incremental Rust rebuilds after a
one-line change took **1m 01s** and **1m 10s** (`src-tauri/_build.log`,
`src-tauri/_dev.log`). Those logs predate the `tokio` and `notify` dependencies,
so a true cold build today is realistically **10 to 14 minutes**.

## Environment variables

Grove has effectively no configuration surface. There is no `.env`, no
`.env.example`, no `VITE_*` variable anywhere in `src/`, and no config loader.
The complete set of variables the code touches:

| Name | Required? | What it is | Where to get it | Example / placeholder |
|---|---|---|---|---|
| `TAURI_DEV_HOST` | No | Read in `vite.config.js`. When set, Vite binds the dev server to that host instead of localhost and switches HMR to `ws://<host>:7421`. Intended for testing from another device on the LAN. Unset for normal desktop work. | You choose it: your machine's LAN IP. | `192.168.1.20` |
| `USERPROFILE` | No (OS-provided) | Read in `src-tauri/src/lib.rs` and `repo/read.rs` to locate the user's home directory for the folder picker and recent-repos list. | Set by Windows automatically. | `C:\Users\<you>` |
| `HOME` | No (OS-provided) | Fallback used only when `USERPROFILE` is absent (i.e. non-Windows). | Set by the OS automatically. | `/home/<you>` |

**There are no secrets in this repository, and none are required to build or run
it.** No API keys, tokens, passwords or connection strings exist in the tree, and
nothing needs to be provisioned before first run. If the bring-your-own-API-key
agent backend described in DESIGN.md section 3 is ever implemented, that design
specifies keys live in the OS keychain via the Tauri keychain plugin and never in
plaintext config or a committed file. Keep it that way.

## Running it

All commands run from the repo root. Scripts are exactly the four in
`package.json`; there are no others.

**Full desktop app with hot reload.** This is the normal way to work. It runs
`npm run dev` first (Tauri's `beforeDevCommand`), waits for the Vite server on
port 7420, then compiles and launches the Rust binary. Frontend edits hot-reload
instantly; Rust edits trigger a full recompile and relaunch of the window.

```bash
npm run tauri dev
```

**Frontend only, in a normal browser, on port 7420.** Much faster to start
because it skips Rust entirely. Use it for pure CSS and layout work. Note the app
will render but every Tauri IPC call fails, because there is no Rust backend
behind it, so the graph, diffs, status and worktree panels will be empty or
error out.

```bash
npm run dev
```

**Production frontend build.** Outputs static assets to `dist/`, which is what
`frontendDist` in `tauri.conf.json` points at.

```bash
npm run build
```

**Preview the built frontend** on Vite's default port 4173 (per
`.claude/launch.json`, which allows auto-port here).

```bash
npm run preview
```

**Release desktop build with installers.** Slow; this is an optimized Rust build
plus bundling.

```bash
npm run tauri build
```

**Tests: none.** There is no test script, no test runner dependency, and no test
files in the repo. `cargo test` in `src-tauri` compiles but has no tests to run.

**Lint / typecheck / format: none configured.** No ESLint, no Prettier, no
`svelte-check`, no `tsc`. `jsconfig.json` sets `checkJs: true`, so a JS-aware
editor will surface type hints, but nothing enforces it in CI or on commit. The
closest thing to a linter is `cargo clippy`, which is not wired into any script.

Ports in use: **7420** for the Vite dev server (pinned, `strictPort: true`),
**7421** for HMR websockets but only when `TAURI_DEV_HOST` is set, **4173** for
`npm run preview`.

## Common startup failures

| Symptom (literal text where verified) | Cause | Fix |
|---|---|---|
| Build runs for minutes then dies at the link step. UNVERIFIED literal text, from memory not reproduced here: ``error: linker `link.exe` not found`` followed by ``note: program not found``. | MSVC C++ build tools are not installed. Rustup installs the compiler but never the Microsoft linker. | Install VS 2022 Build Tools with the "Desktop development with C++" workload (see Prerequisites step 1), then open a NEW shell so PATH is refreshed and rerun `npm run tauri dev`. |
| The Rust build succeeds, `Running target\debug\grove.exe` prints, a window opens but is completely blank/white and stays that way. | WebView2 runtime missing (only happens on Windows 10 or a stripped Windows image; Windows 11 ships it). | Install the Evergreen WebView2 runtime (Prerequisites step 2). Verified present on this machine at version 150.0.4078.105. |
| Vite refuses to start. UNVERIFIED literal text: `Error: Port 7420 is already in use`. Because `strictPort: true` in `vite.config.js`, Vite aborts instead of picking a free port. | A previous `npm run dev`, `npm run tauri dev`, or an orphaned `node.exe` still holds 7420. | Find and kill the holder: `Get-NetTCPConnection -LocalPort 7420` then `Stop-Process -Id <OwningProcess>`. Do NOT "fix" this by changing the port unless you also change `devUrl` (see next row). |
| You change the Vite port in `vite.config.js`, and now `npm run tauri dev` hangs on `Waiting for your frontend dev server to start...` or opens a blank window. | `devUrl` in `src-tauri/tauri.conf.json` is hardcoded to `http://localhost:7420`. It is a second, separate source of truth for the port. | Change BOTH `vite.config.js` `server.port` and `tauri.conf.json` `build.devUrl` to the same value. |
| You "restore" the port to Tauri's documented default 1420 and the dev server now fails to bind with a socket permission error, not an "in use" error. | VERIFIED on this machine: `netsh interface ipv4 show excludedportrange protocol=tcp` lists a reserved range **1375-1474**, which contains 1420. Hyper-V / WinNAT has reserved it, so binding is refused even though nothing is listening. This is exactly why `vite.config.js` uses 7420 and says so in a comment. | Leave the port at 7420. If you must change it, pick something outside every range that command prints (7420 is clear; the nearest reserved block is 7674-7773). |
| Link errors, or crates failing with ABI//toolchain mismatches, on a machine where `link.exe` clearly exists. | The active rustup toolchain is the `-gnu` flavour instead of `-msvc`. Tauri on Windows expects MSVC. | `rustup show` to confirm, then `rustup default stable-x86_64-pc-windows-msvc`. Verified correct default on this machine. |
| App builds and opens fine, the graph renders, but staging or committing fails at runtime. | `git` is not on PATH. Reads mostly go through `gix` (pure Rust, always works), but every write in `src-tauri/src/repo/write.rs` shells out to the real `git` binary. | Install Git for Windows and reopen the shell. Verified working here: git 2.47.1.windows.1. |
| `npm run tauri dev` fails immediately during `Running BeforeDevCommand`, before any Rust compilation. | `node_modules` is missing or partial, so `vite` cannot be resolved. | `npm ci` from the repo root, then retry. |
| First build looks frozen for many minutes at `Building [=======================> ] 475/477: grove`. | Not frozen. This is normal: a cold build compiles roughly 477 crates including all of Tauri and gix. VERIFIED at **8m 29s** in `src-tauri/_build.log`. | Wait it out. Check CPU is pegged if unsure. Never delete `src-tauri/target` to "fix" this; that guarantees another full cold build. |
| VERIFIED literal, last line of `devlog.txt`: ``error: process didn't exit successfully: `target\debug\grove.exe` (exit code: 0xffffffff)`` | Benign. That is the Tauri CLI reporting the exit status after the app window was closed or the dev session was killed. 0xffffffff is -1, i.e. terminated. | Nothing to fix. Not a crash of the build. |
| Dozens of lines of `[vite-plugin-svelte] src/X.svelte:NN `<div>` with a mousedown handler must have an ARIA role` and `a11y_click_events_have_key_events` scroll past on every start. | Svelte 5 accessibility WARNINGS, not errors. VERIFIED throughout `devlog.txt` and `src-tauri/_dev.log`; the app starts fine with all of them present. | Ignore them, or fix the a11y roles properly. They never block a build. |
| `git status` shows `src-tauri/Cargo.toml` as modified, but `git diff` prints no hunks at all, only `warning: in the working copy of 'src-tauri/Cargo.toml', LF will be replaced by CRLF the next time Git touches it`. | VERIFIED: `core.autocrlf=true` is set globally and there is no `.gitattributes` in the repo, so line endings differ from the index with no content change. A phantom dirty file. | Harmless. Do not `git checkout` it reflexively, and do not stage it as part of an unrelated change. It is one of the pre-existing dirty entries in this working tree. |
| Cargo fails mid-build with a disk space or "No space left on device" error, or the machine slows to a crawl during the first build. | `src-tauri/target` is **11 GB** on this machine, and a cold build peaks with many parallel `rustc` processes. On a 16 GB machine that is real memory pressure. | Free disk first. To cap memory during a build, limit parallelism: `cargo build -j 4` from `src-tauri`, or set `$env:CARGO_BUILD_JOBS = "4"` before `npm run tauri dev`. See Gotchas. |

## Committing

- **Configured git identity for this repo** (verified with `git config`):
  `user.name` is `capad.fyi` and `user.email` is `capad.xyz@gmail.com`. The
  global values are `capad.io` / `capad.xyz@gmail.com`, so the name is
  deliberately overridden per-repo. This is a personal project, so the personal
  address is correct here; do not push work-account commits to it.
- **Hooks: none.** `.git/hooks/` contains only the stock `.sample` files. There is
  no husky, no lint-staged, no pre-commit framework, and no `prepare` script in
  `package.json`. Nothing runs on commit, so nothing can block one, and there is
  never a reason to reach for `--no-verify`.
- **Default / integration branch: `main`.** It tracks `origin/main`.
- **Current branch: `reauthor`**, which is **3 commits ahead of `origin/main` and
  0 behind**. It is an in-progress "engine restructure" of the Rust core, done as
  a numbered sequence: step 1 `Engine: refresh coordinator with typed events and
  generation numbers` (adds `repo::service::RepoService`, rewrites the watcher,
  makes all subprocess commands async), step 2 `Engine: lock hardening on the git
  boundary` (adds `--no-optional-locks` to reads and index-lock retry with
  100/300/800/1500ms backoff), step 3 `Engine: cheap heavy-repo wins`
  (concurrent per-worktree status, cheaper untracked-file walking, a batched
  `repos_dirty` command, background `git commit-graph write`). At the time of
  writing `reauthor` has never been pushed; it had no upstream.
- **Branch naming**: mostly work directly on `main` plus occasional
  topic branches. Observed remote branch: `chore/contact-and-readme`, i.e.
  `type/short-kebab-description`. The local `reauthor` is a bare noun, so the
  convention is loose.
- **Commit message style**: two distinct styles in the log. Chores use
  conventional-commit prefixes (`chore: capad contact identity + README badges
  (#1)`). Feature work uses a sentence-style imperative summary, often with an
  area prefix and a semicolon-joined pair of changes, e.g. `Engine: lock
  hardening on the git boundary`, `Perf: tame the watcher, defer refresh under
  input, fewer git calls; 0.1.2`, `Ctrl+F in the diff modal; clamp resizers to
  stay in view`. Version bumps get appended to the summary rather than getting
  their own commit. Bodies, when present, are `-` bullet lists explaining the
  what and the why, and often end with a note about what was deliberately
  deferred.
- **Do not add `Co-Authored-By` trailers.** Some older commits on this branch
  carry them; new commits should not.
- The working tree currently has unrelated in-progress items: the phantom-CRLF
  `src-tauri/Cargo.toml`, plus untracked `.claude/` and `.coderabbit.yaml`. Stage
  files explicitly by path. Never `git add -A`, `git add .`, or `git commit -a`
  in this repo.

Typical flow:

```bash
git add <specific-path>
```

```bash
git commit -m "Area: what changed and why"
```

```bash
git push origin HEAD
```

## Deployment

**Grove does not deploy anywhere.** There is no hosting target, no app store
listing, no npm publish, and no GitHub Release automation.

- **No CI whatsoever.** There is no `.github/` directory in the repo, therefore no
  GitHub Actions workflows, no release workflow, and no required status checks.
  Pushing any branch, including this documentation commit, triggers nothing and
  deploys nothing. There is no Vercel/Netlify/Pages hook to trip.
- **No code signing.** `tauri.conf.json` contains no Windows signing
  configuration (no `certificateThumbprint`, no `digestAlgorithm`, no
  `timestampUrl`) and no macOS `signingIdentity`. Installers are therefore
  unsigned, and Windows SmartScreen will warn on first run for anyone who
  downloads one.
- **No auto-updater.** `tauri.conf.json` has no `plugins.updater` block, no
  `pubkey`, and `tauri-plugin-updater` is not in `Cargo.toml`. Shipping an update
  today means a user manually downloading a new installer.
- **Releasing is a manual local build.** Run it, then upload the artifacts
  wherever you want them:

```bash
npm run tauri build
```

`bundle.targets` is `"all"`, so on Windows this produces both installer formats.
Verified artifact paths and naming, from a previous run on this machine:

- `src-tauri/target/release/bundle/msi/Grove_0.1.3_x64_en-US.msi` (WiX MSI)
- `src-tauri/target/release/bundle/nsis/Grove_0.1.3_x64-setup.exe` (NSIS)
- `src-tauri/target/release/grove.exe` (the bare 10.3 MB binary)

Every prior version is still sitting in that folder (0.1.0 through 0.1.3), which
is a handy accident: it is the closest thing to a release archive that exists.

- **Version bumping before a release** means editing the version in **three**
  places so they stay in sync: `package.json`, `src-tauri/Cargo.toml`, and
  `src-tauri/tauri.conf.json`. The MSI/NSIS filenames come from the
  `tauri.conf.json` value. Nothing automates or validates this.
- **Rollback**: reinstall the previous installer from that bundle folder, or
  `git revert` the offending commit and rebuild. There is no deployed environment
  to roll back.

## Gotchas

- **The dev server port is 7420, not Tauri's documented 1420, and that is
  deliberate.** `vite.config.js` says why in a comment, and it checks out: this
  machine has TCP ports 1375-1474 in the Windows excluded/reserved range (Hyper-V
  or WinNAT), so 1420 cannot be bound. Every tutorial you find will say 1420.
  Do not "correct" it.
- **The port lives in two files.** `vite.config.js` (`server.port`) and
  `src-tauri/tauri.conf.json` (`build.devUrl`). They must match or `tauri dev`
  hangs waiting for a frontend that is on a different port.
- **`src-tauri/src/main.rs` carries a load-bearing attribute with a "Do not
  remove" comment**: `#![cfg_attr(not(debug_assertions), windows_subsystem =
  "windows")]`. Deleting it makes release builds pop a console window behind the
  app. Similarly, `write.rs` and `agent/mod.rs` set `CREATE_NO_WINDOW`
  (`0x0800_0000`) on every spawned process for the same reason; commit d9ea724
  ("Stop console windows flashing on Windows") exists purely because of this.
  Removing those flags reintroduces flashing console windows on every git call.
- **`src-tauri/target` is 11 GB.** Do not delete it casually to "clean up" -
  rebuilding costs 10+ minutes. If you genuinely need the space, `cargo clean` in
  `src-tauri` is the honest way, and accept the cold rebuild.
- **Memory pressure on this specific machine.** A Lenovo i5-12450HX with 16 GB
  RAM will feel a cold Rust build. Cargo defaults to one parallel job per logical
  core (12 here), and each `rustc` plus the final `link.exe` are memory-hungry,
  running alongside Vite/Node and the WebView2 processes the app itself spawns.
  Expect heavy swapping if a browser and an editor are also open. Mitigation:
  cap parallelism with `$env:CARGO_BUILD_JOBS = "4"` before the first build, and
  close other apps for the initial 10-minute compile. Incremental rebuilds
  (about 1 minute) are far gentler and are the normal case.
- **`npm run dev` alone is a trap if you forget what it does.** It starts only
  the frontend. The app shell renders, but every backend call fails because no
  Rust process is listening on the Tauri IPC channel. If panels are mysteriously
  empty, check whether you started `npm run tauri dev` or just `npm run dev`.
- **The a11y warning wall is noise.** Svelte 5 emits many
  `a11y_no_static_element_interactions` / `a11y_click_events_have_key_events`
  warnings on every start. Real errors look different. Do not go hunting a
  startup bug because of them.
- **`git status` lies about `src-tauri/Cargo.toml`.** It is a CRLF phantom
  (`core.autocrlf=true`, no `.gitattributes`), with an empty `git diff`. Adding a
  `.gitattributes` with `* text=auto` would settle it permanently; nobody has.
- **Two untracked files are intentionally uncommitted**: `.claude/` (contains
  `launch.json`, which usefully documents the three run configurations and their
  ports) and `.coderabbit.yaml` (CodeRabbit review config, staged for a future
  PR workflow). Neither is in `.gitignore`, so they will show up in every
  `git status`. Do not sweep them into an unrelated commit.
- **`devlog.txt` and `src-tauri/_dev.log` / `_build.log` are captured console
  output, not documentation.** `devlog.txt` is gitignored (`*.log` plus an
  explicit `devlog.txt` entry); the two underscore-prefixed logs in `src-tauri/`
  are untracked build captures. They are useful forensics (the verified build
  timings in this runbook came from them) but they are stale, referencing
  versions 0.1.0 and 0.1.2.
- **`src-tauri/gen/` is gitignored but required.** Tauri regenerates the schemas
  there during build. If your editor flags the `$schema` reference in
  `capabilities/default.json` as unresolved on a fresh clone, run a build once.
- **Permissions are minimal.** `src-tauri/capabilities/default.json` grants only
  `core:default` to the `main` window. Adding a Tauri plugin means adding its
  permission here too, or the frontend call fails at runtime with a permission
  error rather than a compile error.
- **CSP is disabled.** `app.security.csp` is `null` in `tauri.conf.json`. Fine for
  a local-only pre-alpha, worth tightening before any public release.
- **Dead scaffolding compiles but is unused.** `src-tauri/src/agent/mod.rs`
  carries `#![allow(dead_code)]` and defines the `Agent` trait, `PrDraft` and
  `Manual`, none of which are wired up; only the free function
  `generate_message` is actually called. The build prints 5 warnings about this
  plus a deprecated `gix` `work_dir()` call in `repo/read.rs:15` (should be
  `workdir()`). All expected, none fatal.
- **The `reauthor` branch is mid-restructure.** DESIGN.md describes the intended
  architecture, but the three engine commits on this branch already deviate from
  and extend it. Trust the code and the commit bodies over DESIGN.md for the
  refresh/locking behaviour specifically. Both commit bodies explicitly list work
  deferred to "Phase 2" (a typed `GroveError` IPC surface, and an opt-in
  `core.fsmonitor` repo setting), so those are known gaps, not oversights.

## Project map

```
Grove/
  index.html            Vite entry point; mounts /src/main.js into <div id="app">
  package.json          4 npm scripts (dev, build, preview, tauri) + frontend deps
  package-lock.json     npm lockfile, version 3
  vite.config.js        Vite + Svelte plugin; dev server pinned to port 7420
  svelte.config.js      Svelte config; vitePreprocess only
  jsconfig.json         JS-only editor config, checkJs enabled (no TypeScript)
  README.md             Public pitch, positioning, quickstart
  DESIGN.md             Thesis, locked decisions, IPC sketch, v0 scope
  RUNBOOK.md            This file
  LICENSE               GPL-3.0-or-later
  devlog.txt            Captured dev-session console output; gitignored
  dist/                 vite build output; gitignored; Tauri's frontendDist
  src/                  Svelte 5 frontend (flat, one component per surface)
    main.js             Mounts App.svelte
    App.svelte          Root shell, layout, keyboard handling
    state/repo.svelte.js  Single subscription to backend repo events (runes)
    CommitGraph.svelte  Custom virtualized commit graph renderer
    DiffView / DiffModal / FileView / CommitDetail / Changes / Worktrees .svelte
    Home / NavHub / Spotlight / Finder / BranchPicker / Skeleton .svelte
    styles.css          Global styles
  src-tauri/            Rust core + Tauri configuration
    tauri.conf.json     Window, bundle targets, devUrl (7420), frontendDist
    Cargo.toml          Rust deps (gix, notify, tokio, anyhow, serde)
    Cargo.lock          Committed Rust lockfile
    build.rs            tauri-build codegen
    capabilities/       Tauri 2 permissions; default.json grants core:default
    icons/              App icon set (ico, icns, png)
    app-icon.png        Source icon the icon set is generated from
    gen/                Tauri-generated schemas; gitignored
    target/             Cargo build cache; gitignored; ~11 GB
    _build.log/_dev.log Untracked captured build output; source of the timings above
    src/
      main.rs           Binary shim; sets windows_subsystem (do not remove)
      lib.rs            Tauri setup + invoke_handler registering 33 commands
      repo/read.rs      gix-backed and git-backed reads (graph, status, blame)
      repo/write.rs     git CLI writes; CREATE_NO_WINDOW; index-lock retry
      repo/service.rs   RepoService refresh coordinator, typed events, generations
      repo/watch.rs     Filesystem watcher; classifies Refs/Index/Workdir/Worktrees
      agent/mod.rs      BYO-agent trait + local CLI commit messages via `claude -p`
```
