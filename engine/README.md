# @grove/engine

Grove's git engine, headless. It spawns the user's `git` binary and turns its
output into typed repo state. No UI, no Electron, no window — an app shell maps
these functions onto IPC handlers and that is the entire contract.

This is a port of `src-tauri/src/repo` + `src-tauri/src/agent` from Rust to
TypeScript, done as **phase 1** of the move off Tauri. `src-tauri/` is still
present and still builds; it stays as the reference implementation until the
React frontend reaches parity.

## Why the port was cheap

The Rust engine used `gix` in exactly three places, all `gix::discover`. Every
real operation — graph, blame, diff, status, worktrees, grep, log — already
shelled out to `git` and parsed stdout. So this is a translation of parsing and
process handling, not a reimplementation of git. Discovery is the one piece
that needed replacing, and `discover.ts` does the same upward walk in-process,
which keeps the subprocess count per operation identical to the Rust original.

## Layout

| File | Role |
|---|---|
| `git.ts` | The only place that spawns `git`. Lock retry, `--no-optional-locks`, `windowsHide`. |
| `discover.ts` | Repository discovery — the walk `gix::discover` was doing. |
| `parse.ts` | Pure parsers for git's output. No I/O, so they test without a repo. |
| `read.ts` | Read paths: graph, detail, diff, blame, status, worktrees, search. |
| `write.ts` | Mutations: stage, unstage, commit, clone. |
| `watch.ts` | Filesystem watcher; classifies events into invalidation bits. |
| `service.ts` | Refresh coordinator: coalescing, generation numbers, change detection. |
| `agent.ts` | Bring-your-own-agent: local CLI backend + the `Manual` fallback. |
| `recents.ts` | Recently opened repositories. |
| `index.ts` | Public surface + `watchRepo`, which ties service and watcher together. |

## Behaviour carried over deliberately

These exist because an AI agent may be writing to the repo while Grove reads
it. They are not incidental:

- **Index-lock retry** (`git.ts`) — backoff `100/300/800/1500`ms when git loses
  the race for `index.lock`. We never delete the lock; the other process owns it.
- **`--no-optional-locks` on every read** — stops git taking opportunistic locks
  (e.g. the status untracked-cache refresh) so a background refresh can never
  collide with an agent mid-commit.
- **`windowsHide` on every spawn** — the Rust code set `CREATE_NO_WINDOW`.
  Without it, a packaged Windows app flashes a console on every `git` call.
- **Event classification** (`watch.ts`) — a ref update recomputes only the
  graph; a workdir save recomputes only status. `.git/index` is watched because
  that is precisely the signal that an agent staged files.
- **Coalescing** (`service.ts`) — 80ms quiet window, 350ms ceiling. A lone
  stage click lands in ~80ms; an agent's save-storm collapses into one cycle.

Two things needed different handling in Node than in Rust, and both would have
been silent data loss:

- `String.split(sep, limit)` **discards** the remainder where Rust's `splitn`
  keeps it. `splitN` in `parse.ts` restores Rust's behaviour — without it every
  multi-paragraph commit body is truncated. There is a test pinning this.
- `execFile` caps output at `maxBuffer` and truncates past it. `git.ts` streams
  into buffers instead, because `git log --all --name-only` on a large repo
  blows through any cap worth setting.

## Running it

```bash
npm install
npm run check
```

`check` runs the typechecker over everything (tests included) and then the test
suite. Tests run straight off the TypeScript source via Node's type-stripping —
no build step. `npm run build` emits `dist/` for consumption by an app shell.

The suite is 44 tests: pure-parser tests, the watcher classification tests
ported verbatim from the Rust, coordinator tests covering coalescing and
change detection, and an integration suite that drives real `git` against a
scratch repository.
