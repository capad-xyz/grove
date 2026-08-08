# Grove re-author — X post drafts

Drafts only. Nothing here has been posted anywhere. Review, edit, post whatever
survives.

- Account: **@capad** · capad.fyi · github.com/capad-xyz/grove
- Every number below is traceable to a commit message on `reauthor` or to a file
  in this repo. Nothing is estimated, rounded up, or invented. See
  [Sourcing and open questions](#sourcing-and-open-questions).
- **Character counts are measured, not eyeballed.** Each was computed with X's
  weighted-length rules (URLs count as 23 regardless of length; code points
  outside the Latin-1/general-punctuation ranges count as 2). All are ≤ 280.
- Two counting quirks worth knowing:
  - `→` is charged 2 characters, and so is the ASCII `->`. They cost the same, so
    the drafts use `->` purely because it survives copy-paste anywhere. An em
    dash `—` is charged only 1, which is why it is cheaper than `--`.
  - A bare **`capad.fyi` is auto-linked and charged 23 characters**, not 9, so
    naming the portfolio by domain is expensive inside a post. The drafts say
    "my portfolio" instead and spend the 23 on the repo link.

---

## 1. Announcement post

### Variant A — plain and factual — **274 / 280**

```
Grove: a free git review companion that sits beside your AI editor and shows what changed while you were away. Worktrees get a surface, not a dropdown.

Rebuilt: Tauri+Svelte -> Electron+React+TS, engine Rust -> Node.

Early. Unsigned, Windows-only.

github.com/capad-xyz/grove
```

### Variant B — with more personality — **277 / 280**

```
Your editor shows what an agent did while you were away in a panel the width of a receipt.

Grove is the review surface instead: worktrees get their own strip, and the commit list marks what changed while you were gone.

Free, GPL-3.0. Early, unsigned.

github.com/capad-xyz/grove
```

> **Why not "worktrees are first-class":** it is true of the *design* — the
> worktree strip spans the top rather than hiding in a dropdown — but `README.md`
> is clear that the strip "lists worktrees but cannot add, remove, prune, or
> switch". "Gets a surface, not a dropdown" claims the layout without implying
> the verbs. Worth keeping that distinction until the verbs exist.

---

## 2. Thread — the rebuild story (8 posts)

**1/** — **277 / 280**

```
Grove is a git review companion that sits beside your AI coding editor. Worktrees are a first-class surface, and it answers one question: what changed while you were away.

I just rebuilt it. Tauri+Svelte -> Electron+React+TS, engine Rust -> Node.

Some of what that turned up:
```

**2/** — **269 / 280**

```
Clicking a commit froze the window.

The renderer measured 0 CPU the whole time it was unresponsive. All of it was in the main process: building a diff asked git once per changed file, and each of those spawned rev-parse + diff.

A 21-file commit cost ~43 subprocesses.
```

**3/** — **258 / 280**

```
git show --patch --first-parent does the whole thing in one spawn.

913ms and 43 spawns -> 93ms and 1.

Output byte-identical, give or take 20 characters -- which turned out to be exactly the 20 newlines the old path had been joining its per-file diffs with.
```

**4/** — **275 / 280**

```
The file watcher was the second cost. It was walking .git/objects: 2,934 of 4,232 ignore checks, 69% of its traversal, spent on events the classifier has always scored as noise.

Excluded that and the other git internals we never read.

23% of a core -> 4%. RSS 74MB -> 45MB.
```

**5/** — **268 / 280**

```
Grove's design system has one load-bearing rule:

Diff green and diff red are the only saturated colours in the app.

It follows from "diffs are the content": colour on a selected row competes with the + and - you opened Grove to read. So state is brightness, not hue.
```

**6/** — **275 / 280**

```
The palette is my portfolio's, inverted -- three colours, no accent at all.

Unexpected finding: contrast does not survive inversion. The grey that clears AA sitting on paper reaches 3.85:1 on ink, and in Grove it carries SHAs at 9.5px.

Same hue, ~4% more luminance, 4.51:1.
```

**7/** — **254 / 280**

```
Markdown previews render to a token tree, then to React elements. No HTML string is built anywhere in the path, so injection is impossible by construction rather than by filtering.

Grove renders content from repositories it did not write and cannot vet.
```

**8/** — **268 / 280**

```
Honest status: early. No code signing, no auto-updater, no CI, and builds and measurements so far are Windows-only. The worktree strip lists worktrees but cannot yet add, switch or prune.

Free, GPL-3.0, and it uses the agent you already have.

github.com/capad-xyz/grove
```

### Alternates — swap any of these in

Each is a drop-in replacement for a middle post (2–7), already sized. Post 8
should stay last either way.

**Alt A — the engine port** — **259 / 280**

```
The engine port was smaller than I expected.

gix appeared in exactly three places, all of them gix::discover. Every real operation already shelled out to git and parsed stdout.

So the port translated parsing and process handling. It did not reimplement git.
```

**Alt B — the .mp4 freeze** — **272 / 280**

```
Previewing an .mp4 locked the whole app, and rendered its raw bytes as thousands of green + lines on the way.

A file with no diff was assumed to be new text, then read whole and synchronously in main -- which owns every IPC reply. Media streams over its own protocol now.
```

**Alt C — the filename that lied** — **270 / 280**

```
`direction: rtl` so the ellipsis eats the directory, not the filename.

But a leading dot gets reordered under RTL, so .coderabbit.yaml painted as coderabbit.yaml.

The DOM held the right string the whole time. Only the paint lied.

That is how you stage the wrong file.
```

---

## 3. Standalone posts

Each stands alone. Post them weeks apart if you like; none depends on the thread
or on the announcement, and none names Grove more than it has to.

### A — The 43 subprocesses — **277 / 280**

```
A diff view that froze the window.

The renderer measured 0 CPU the entire time. It was the main process: one git call per changed file, each spawning rev-parse + diff. A 21-file commit cost ~43 subprocesses.

git show --patch --first-parent: 913ms and 43 spawns -> 93ms and 1.
```

### B — 69% of a file watcher's work, on files it always ignored — **266 / 280**

```
Profiled a file watcher.

2,934 of 4,232 ignore checks -- 69% of its traversal -- were spent walking .git/objects. Every one of those events had always been classified as noise anyway.

Excluded the git internals we never read: 23% of a core -> 4%, RSS 74MB -> 45MB.
```

### C — Contrast does not survive inversion — **278 / 280**

```
Tied my app's palette to my portfolio's, inverted. Same three colours, dark-side up.

The grey that comfortably clears AA sitting on paper reaches 3.85:1 on ink -- and in the app it carries SHAs at 9.5px, which need more contrast than body text, not less.

Re-check, don't copy.
```

### D — The bug was not where it looked — **274 / 280**

```
Previewing an untracked .mp4 rendered its raw bytes as thousands of green + lines, and locked the window while it did.

Two faces, one cause: a file with no diff was assumed to be new text, then read whole and synchronously in the main process -- which owns every IPC reply.
```

### Spares

**Classify before you read** — **248 / 280**

```
Files are classified before they are read now.

Binary is decided the way git decides it: a NUL byte in the first 8KB. So asking whether a 400MB video is text costs one small read instead of loading the thing.

Extensions are a hint, not an answer.
```

**Markdown without an HTML string** — **272 / 280**

```
Grove renders markdown from repositories it did not write and cannot vet.

So the parser emits a token tree and the component renders those tokens as React elements. No HTML string is built anywhere in the path -- injection is impossible by construction, not by filtering.
```

**The filename that lied** — see Alt C above (270 / 280).

---

## Sourcing and open questions

### Where each number comes from

| Claim | Source |
|---|---|
| 913ms / 43 spawns -> 93ms / 1; 21-file commit; renderer at 0 CPU | commit `7c4483b` "Perf: find and fix the freeze" |
| 2,934 of 4,232 ignore checks, 69%; 23% -> 4% of a core; RSS 74MB -> 45MB | commit `7c4483b` |
| `git show --format= --patch --first-parent` is the single spawn | `engine/src/read.ts:152` |
| "Diff green and diff red are the only saturated colours" | `app/DESIGN-SYSTEM.md` §2 |
| Palette inverted from capad.fyi; three colours, no accent; 3.85:1 -> 4.51:1 at ~4% more luminance; SHAs at 9.5–10.5px | `app/DESIGN-SYSTEM.md` §3, commit `34a673e` |
| Markdown token tree, no HTML string, links limited to http/https/mailto | commit `2541e7e`; `app/src/renderer/src/data/markdown.ts:38`; the only occurrence of `dangerouslySetInnerHTML` in the renderer is a comment in `Markdown.tsx:6` saying there should never be one |
| gix in exactly three places, all `gix::discover` | commit `a97c354` |
| .mp4 rendering as thousands of green `+` lines and locking the window; synchronous whole-file read in main; 50MB clip -> 67MB base64 string; streams over `grove-file://` with range requests | commit `a4d674f` "Preview: classify files before reading them, and stream media" |
| Binary decided on a NUL byte in the first 8KB; 400MB video costs one small read; text capped at 2MB | commit `a4d674f`; `engine/src/read.ts` (`looksBinary`, `MAX_TEXT_PREVIEW_BYTES`) |
| RTL filename bug (`.coderabbit.yaml` painting as `coderabbit.yaml.`) | commit `7eb1962` |
| No code signing, no auto-updater, no CI; Windows-only builds and measurements | `README.md` Status § states this verbatim; corroborated by no signing keys in `app/electron-builder.yml`, no `.github/` in the repo, and only `win-unpacked` outputs under `app/release*` (mac dmg and linux AppImage targets are declared but never built) |
| Worktree strip lists but cannot add, remove, prune or switch | `README.md` Status § ("Not built yet") |

### Claims I was unsure about, and what I did

- **The .mp4 fix landed while these drafts were being written.** It was
  uncommitted working-tree code when I first read it and is now commit `a4d674f`.
  The drafts cite the commit. Worth re-reading that message before posting — it
  is the source for every media claim here.
- **The .mp4 posts say "locked the window", not "froze for N seconds".** The
  commit describes the lock and its cause but gives no duration, so no draft
  states one. It also gives no measured before/after for this fix, unlike the
  subprocess and watcher work — which is why the media posts carry a symptom and
  a cause rather than a benchmark.
- **"the second cost."** The freeze had three causes (subprocess storm, watcher
  traversal, and a refresh coordinator that bounded how often a refresh started
  but not what one cost). The thread covers two and does not claim to cover all
  of them.
- **Test counts.** The commits state them per-commit — engine 45, renderer 85,
  smoke 25 as of `4901494` — but they change with nearly every commit, so no
  draft quotes one. A tweet with a test count goes stale the same week.
- **Timing words.** No draft says "this month" or "in two weeks". I could not
  verify the elapsed span of the re-author from the repo alone, and a wrong
  timeline is the easiest thing for a reader to catch.

### Things I deliberately left out

- Any adoption number — stars, downloads, users, testers, praise. None exists in
  the repo, and there is nothing to cite.
- Any head-to-head with GitKraken, Tower, Fork, or GitButler. `README.md` lists
  their pricing and licensing, but nothing is benchmarked against them, and a
  competitor claim in a launch post invites a correction you cannot win.
- Bundle size or startup time, Electron vs. the old Tauri build. Neither was
  measured, and Electron would very likely lose on binary size — best not raised.

### Before you post: check the landing page

Every draft here links to the repo, so `README.md` is the landing page for all of
them. It was still describing the Tauri + Svelte stack when I started writing
these; it has since been rewritten to describe Electron + React + TypeScript,
including an explicit "Not built yet" list. **That rewrite is uncommitted at the
time of writing** — commit it before posting, or the link goes to the old text.

Two things still to check:

1. **`RUNBOOK.md` is still written against the Tauri build** — its Stack section
   documents Tauri 2 / Svelte 5 / Vite 6 / `gix 0.85.0` as current. The rewritten
   README already flags this, so it is disclosed rather than misleading, but a
   visitor who opens it will read a stack that no longer exists.
2. **`DESIGN.md`'s "locked decisions" table predates the re-author** and still
   lists Tauri, Svelte and `gix`. Same situation: the README flags it. Thread
   post 5 and post 6 both cite the design work, so expect some readers to open
   `DESIGN.md` rather than `app/DESIGN-SYSTEM.md`, which is the one that is
   current.
