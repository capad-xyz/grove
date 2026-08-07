# Grove — Design System

**Direction: Instrument.** Chosen 2026-08-07, from three authored directions.

This document is the source of truth for how Grove looks and behaves. It exists
because the previous interface was adopted from a screenshot rather than
authored, and nobody could say *why* any value was what it was. Every token
below has a reason, and the reason is always about Grove specifically.

If you change a value here, change the reason with it. A token whose
justification is "it looked nicer" is a token that will drift.

---

## 1. What Grove is, and what that demands

From `DESIGN.md`: a git review surface that sits **beside** an AI coding editor,
refreshing live as an agent changes the repo underneath you. The stated test for
every feature is *"would I keep this window open beside my editor while
coding?"*

Four consequences follow, and they generate everything else:

**It is never the main window.** Grove shares a screen with the editor the user
is actually working in. If Grove is the brightest or busiest thing on that
screen, it has failed — the user will close it. The chrome recedes.

**Diffs are the content.** Everything else is navigation to reach a diff. So the
diff must win every contest for attention it enters.

**State changes without the user acting.** An agent stages files and commits
while the user is reading. The interface has to say "this changed under you"
without yanking the reader's eye or moving what they were reading.

**Screen budget varies wildly.** Docked at 500px beside an editor, or open wide
on a second monitor. Both are real; neither is the "correct" one.

---

## 2. The load-bearing rule

> **Diff green and diff red are the only saturated colours in the application.**

Everything in the chrome — selection, hover, focus, headers, borders, buttons,
counts — is greyscale. This is not minimalism for its own sake. It is the direct
consequence of "diffs are the content": if the interface spends colour on a
selected row, that colour competes with the `+` and `−` the user came to read.

There is exactly one exception, defined in §5.

Every other design rule in this document exists to make this one affordable.

---

## 3. Colour

Greyscale is warm-shifted (a touch of red/yellow in the neutrals) rather than
pure. Pure grey next to a warm editor theme reads as blue and looks cold; warm
neutrals sit beside any editor without arguing with it.

### Surfaces

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0e0e0f` | Window background. Darker than most editors on purpose, so Grove reads as *behind* the editor, not competing with it. |
| `--surface` | `#141415` | Panels, the commit list, anything sitting on `--bg`. |
| `--surface-raised` | `#1a1a1c` | Hovered rows, inputs, the one step above a panel. |
| `--surface-sunken` | `#0a0a0b` | Diff background — recedes so the diff's own colour carries. |

### Lines

| Token | Value | Use |
|---|---|---|
| `--line` | `#242426` | Panel edges, section rules. Visible but never structural-looking. |
| `--line-soft` | `#1a1a1c` | Row separators. Should read as rhythm, not as a table. |
| `--line-strong` | `#3a3a3d` | The 2px left rule marking a selected row. |

### Text

Four steps, no more. A fifth step always turns out to mean "I hadn't decided."

| Token | Value | Use |
|---|---|---|
| `--text` | `#e8e8e6` | Commit subjects, file names, diff code. Not pure white — pure white on near-black vibrates at small sizes. |
| `--text-dim` | `#9a9a97` | Metadata that is read second: author, relative time, branch. |
| `--text-faint` | `#6a6a68` | Structural labels, SHAs, line numbers. Present, not competing. |
| `--text-ghost` | `#4a4a48` | Disabled, placeholder, empty-state. |

### Diff — the only saturated colours

| Token | Value | Use |
|---|---|---|
| `--add` | `#5fbf7f` | `+` lines, insertion counts. |
| `--del` | `#e06666` | `−` lines, deletion counts. |
| `--add-bg` | `rgba(95,191,127,.10)` | Added-line background. |
| `--del-bg` | `rgba(224,102,102,.10)` | Removed-line background. |

Backgrounds are deliberately weak. The foreground colour already says which side
a line is on; a strong background makes long diffs exhausting to read.

---

## 4. Type

**Mono everywhere.** Grove is an extension of the editor surface, and a sans
chrome around mono content creates a seam that says "this is a different
program." One family, one rhythm.

```
--font: ui-monospace, "Cascadia Code", "JetBrains Mono", Consolas, monospace
```

| Token | Size | Use |
|---|---|---|
| `--fs-code` | 12px | Diff content. The one place legibility beats density. |
| `--fs-body` | 11.5px | Commit subjects, file paths, primary rows. |
| `--fs-meta` | 10.5px | Author, time, SHA, counts. |
| `--fs-label` | 9.5px | Section headers. Uppercase, `letter-spacing: .07em`. |

Line-height is `1.25` in lists (density) and `1.5` in diffs (readability). Those
are different jobs and should not share a value.

---

## 5. State without colour

Since colour is spent on diffs, state is carried by **brightness and rule**:

| State | Expression |
|---|---|
| Hover | Background steps to `--surface-raised`. No text change. |
| Selected | Background steps up **and** a 2px `--line-strong` left rule. |
| Focus (keyboard) | Same 2px rule, plus text steps to `--text`. Visible without a colour ring. |
| Disabled | Text drops to `--text-ghost`. Nothing else changes. |

### The one exception: "since you last looked"

Grove's actual superpower is *everything that changed while you were away*. That
is the single most important thing on screen when the window regains focus, and
it is the one place greyscale genuinely cannot carry the meaning.

So exactly one accent hue exists, and it is used **only** to mark new-since-last-look —
never for buttons, links, focus rings, or branding.

```
--accent:      <awaiting the value from capad.fyi>
--accent-soft: same hue at ~12% alpha
```

**Constraint on whatever value is chosen:** it must not sit adjacent to diff
green or diff red on the hue wheel, or it will misread as a diff signal at a
glance. That rules out oranges/clays (too close to `--del`) and mid-greens (too
close to `--add`). Violets, blues, and cyans are all safe.

Until that value is supplied, `--accent` is set to a neutral bright grey, which
is a legitimate resting state for this direction rather than a placeholder — the
system is designed to work with no hue at all.

---

## 6. Density and rhythm

| Token | Value | Reason |
|---|---|---|
| `--row` | `24px` | A commit row. Tight enough that ~30 commits fit in a docked strip. |
| `--row-lg` | `30px` | Worktree rows, which carry more state per row. |
| `--pad` | `9px` | Horizontal padding everywhere. One value; more creates visual noise. |
| `--gap` | `7px` | Between inline elements in a row. |
| `--radius` | `3px` | Barely rounded. Instruments have square corners; heavy rounding reads consumer. |

No shadows. Depth is expressed by surface value alone. A drop shadow on a dark
surface is mud, and it implies a physicality this interface does not claim.

---

## 7. Motion

Agents write to the repo while the user reads. Motion exists to say *this
changed under you* — and for nothing else.

**Layout never moves.** A row that changes flashes brightness and decays back
over `--flash` (600ms). It does not slide, grow, or reorder under the cursor.
Reordering something a user is mid-read on is the most hostile thing a live
interface can do.

```
--flash: 600ms
--ease:  cubic-bezier(.2, 0, .2, 1)
```

Transitions are permitted on `background-color`, `color`, and `opacity`.
They are **not** permitted on `height`, `width`, `transform`, or anything that
moves a neighbour.

Respect `prefers-reduced-motion`: drop the flash to an instant state change.

---

## 8. Layout

Both postures are real, so the layout adapts on one breakpoint at **700px**.

**Narrow (< 700px)** — docked beside an editor. Single column: worktree strip,
commit list, status. A diff opens as a full-surface overlay, because there is no
room for two panes and a cramped diff is worse than a modal one.

**Wide (≥ 700px)** — two panes. Commits left at a fixed ~360px, diff right
taking the remainder. The worktree strip spans the top.

The breakpoint is on **container width, not viewport**, so the layout is correct
inside an Electron window at any size without depending on the display.

---

## 9. What is deliberately absent

Listed so nobody re-adds them thinking they were forgotten:

- **No gradients, no glows, no shadows.** Depth comes from surface value.
- **No coloured buttons.** A primary action is brighter, not bluer.
- **No icon-only controls without a label** — an icon-only toolbar is a memory test.
- **No branding colour in the chrome.** Grove's identity is its density and its
  quietness, not a hue.
- **No animated spinners on refresh.** Refresh is constant and ambient; a
  spinner every time an agent touches the repo would strobe. Use a subtle
  brightness pulse on the affected section instead.
