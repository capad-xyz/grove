/**
 * Phase 3 bridge harness.
 *
 * Its only job is to prove the wiring end to end: that `window.grove` exists,
 * that reads cross the boundary, that a write pokes the coordinator, and that
 * coordinator events arrive back in the renderer. Phase 4 deletes this file and
 * replaces it with the real, design-first React interface.
 */

import type { RepoEventEnvelope } from '@grove/engine';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el as T;
};

const statusEl = $('status');
const pathInput = $<HTMLInputElement>('path');
const repoEl = $('repo');
const workEl = $('work');
const commitsEl = $('commits');
const logEl = $('log');

let openPath: string | null = null;
let unsubscribe: (() => void) | null = null;

function note(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.className = isError ? 'err' : '';
}

function defineList(pairs: [string, string][]): void {
  repoEl.replaceChildren(
    ...pairs.flatMap(([k, v]) => {
      const dt = document.createElement('dt');
      dt.textContent = k;
      const dd = document.createElement('dd');
      dd.textContent = v;
      return [dt, dd];
    }),
  );
}

function logEvent(event: RepoEventEnvelope): void {
  const row = document.createElement('div');

  const gen = document.createElement('span');
  gen.className = 'gen';
  gen.textContent = `gen ${event.gen}  `;

  const kind = document.createElement('span');
  kind.className = event.kind === 'refresh_error' ? 'err' : 'kind';
  kind.textContent = event.kind;

  const detail = document.createElement('span');
  detail.className = 'gen';
  detail.textContent = summarise(event);

  row.append(gen, kind, detail);
  logEl.prepend(row);
  while (logEl.childElementCount > 40) logEl.lastElementChild?.remove();
}

function summarise(event: RepoEventEnvelope): string {
  switch (event.kind) {
    case 'graph_changed':
      return `  ${event.commits.length} commits, head ${event.head ?? 'detached'}, ${event.unpushed.length} unpushed`;
    case 'status_changed':
      return `  ${event.status.staged.length} staged / ${event.status.unstaged.length} unstaged / ${event.status.untracked.length} untracked${event.dirty ? ' (dirty)' : ''}`;
    case 'worktrees_changed':
      return `  ${event.worktrees.length} worktree(s)`;
    case 'branches_changed':
      return `  ${event.branches.join(', ')}`;
    case 'refresh_error':
      return `  ${event.op}: ${event.message}`;
  }
}

async function refreshPanels(path: string): Promise<void> {
  const [summary, commits, status, worktrees, branches] = await Promise.all([
    window.grove.openRepo(path),
    window.grove.commitGraph(path, 20, null),
    window.grove.workingStatus(path),
    window.grove.worktrees(path),
    window.grove.branches(path),
  ]);

  defineList([
    ['head', summary.head ?? '(detached)'],
    ['git dir', summary.path],
    ['bare', String(summary.is_bare)],
    ['branches', branches.join(', ')],
    ['worktrees', String(worktrees.length)],
  ]);

  workEl.textContent =
    [
      `branch     ${status.branch ?? '(detached)'}`,
      `staged     ${status.staged.map((f) => `${f.status} ${f.path}`).join('\n           ') || '—'}`,
      `unstaged   ${status.unstaged.map((f) => `${f.status} ${f.path}`).join('\n           ') || '—'}`,
      `untracked  ${status.untracked.join('\n           ') || '—'}`,
    ].join('\n');

  commitsEl.textContent = commits
    .map((c) => `${c.short}  ${c.summary}`)
    .join('\n');
}

async function openRepo(): Promise<void> {
  const path = pathInput.value.trim();
  if (!path) return;

  try {
    note(`opening ${path}…`);
    unsubscribe?.();
    await window.grove.unwatchRepo();

    await refreshPanels(path);
    openPath = path;

    unsubscribe = window.grove.onRepoEvent(logEvent);
    await window.grove.watchRepo(path);

    const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? path;
    await window.grove.addRecentRepo(path, name);

    note(`watching ${path} — edit a file or stage something to see events`);
  } catch (e) {
    note(e instanceof Error ? e.message : String(e), true);
  }
}

async function guard(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    note(e instanceof Error ? e.message : String(e), true);
  }
}

$('open').addEventListener('click', () => void openRepo());
pathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') void openRepo();
});

$('stageAll').addEventListener('click', () => {
  if (openPath) void guard(() => window.grove.stageAll(openPath!));
});
$('unstageAll').addEventListener('click', () => {
  if (openPath) void guard(() => window.grove.unstageAll(openPath!));
});

// Boot: confirm the bridge is actually there, then offer the last repo opened.
void (async () => {
  if (typeof window.grove?.openRepo !== 'function') {
    note('window.grove is missing — the preload did not load', true);
    return;
  }

  const recents = await window.grove.recentRepos();
  if (recents[0]) pathInput.value = recents[0].path;

  note(
    `bridge ready — ${recents.length} recent repo(s). Enter a path and press Open.`,
  );
})();
