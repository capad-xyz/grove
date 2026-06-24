<script>
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import CommitGraph from "./CommitGraph.svelte";
  import CommitDetail from "./CommitDetail.svelte";
  import Picker from "./Picker.svelte";
  import Worktrees from "./Worktrees.svelte";
  import Changes from "./Changes.svelte";
  import Spotlight from "./Spotlight.svelte";
  import FileView from "./FileView.svelte";
  import BranchPicker from "./BranchPicker.svelte";
  import Copy from "./Copy.svelte";

  let view = $state("home"); // "home" | "repo"
  let tab = $state("graph"); // "graph" | "worktrees"
  let path = $state("");
  let repo = $state(null);
  let commits = $state([]);
  let unpushed = $state([]);
  let error = $state("");
  let selected = $state(null);
  let finderOpen = $state(false);
  let fileView = $state(null);
  let live = $state(false);
  let liveTick = $state(0);
  let listening = false;
  let branches = $state([]);
  let branch = $state(""); // "" = all branches
  let detailWidth = $state(520); // resizable detail/diff pane

  function startResize(e) {
    e.preventDefault();
    const onMove = (ev) => {
      detailWidth = Math.max(340, Math.min(window.innerWidth - 280, window.innerWidth - ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  // Precomputed file index for instant Spotlight search. Built once per repo
  // (ls-files immediately, the full "every path ever" set in the background)
  // and grown on live-refresh, so it is never re-walked from scratch.
  let fileIndex = $state([]);
  let knownPaths = new Set();

  const buildEntry = (f) => ({
    path: f,
    lower: f.toLowerCase(),
    base: (f.split(/[\\/]/).pop() || "").toLowerCase(),
  });

  function addFiles(files) {
    let added = false;
    for (const f of files) {
      if (f && !knownPaths.has(f)) {
        knownPaths.add(f);
        added = true;
      }
    }
    if (added) fileIndex = Array.from(knownPaths, buildEntry);
  }

  function loadFiles(p) {
    invoke("list_files", { path: p }).then(addFiles).catch(() => {});
    invoke("all_files", { path: p }).then(addFiles).catch(() => {});
  }

  const repoName = $derived(
    repo?.workdir ? repo.workdir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "",
  );

  async function openRepo(p) {
    error = "";
    selected = null;
    tab = "graph";
    finderOpen = false;
    fileView = null;
    branch = "";
    knownPaths = new Set();
    fileIndex = [];
    try {
      repo = await invoke("repo_open", { path: p });
      commits = await invoke("commit_graph", { path: p, limit: 400, refspec: null });
      unpushed = await invoke("unpushed_commits", { path: p }).catch(() => []);
      branches = await invoke("branches", { path: p }).catch(() => []);
      path = p;
      view = "repo";
      const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
      invoke("add_recent_repo", { path: p, name }).catch(() => {});
      invoke("watch_repo", { path: p })
        .then(() => (live = true))
        .catch(() => (live = false));
      loadFiles(p);
    } catch (e) {
      error = String(e);
      view = "home";
    }
  }

  function backToPicker() {
    view = "home";
    selected = null;
    finderOpen = false;
    fileView = null;
    live = false;
    invoke("unwatch_repo").catch(() => {});
  }

  async function onBranchChange() {
    selected = null;
    try {
      commits = await invoke("commit_graph", { path, limit: 400, refspec: branch || null });
    } catch (e) {
      error = String(e);
    }
  }

  // Re-fetch the repo's data when the watcher reports a change.
  async function refresh() {
    if (view !== "repo" || !path) return;
    try {
      commits = await invoke("commit_graph", { path, limit: 400, refspec: branch || null });
      unpushed = await invoke("unpushed_commits", { path }).catch(() => []);
      repo = await invoke("repo_open", { path });
      invoke("list_files", { path }).then(addFiles).catch(() => {}); // pick up new files
      liveTick++; // nudge the worktrees view to reload too
    } catch {}
  }

  $effect(() => {
    if (listening) return;
    listening = true;
    listen("repo-changed", () => refresh());
  });
</script>

{#snippet leaf()}
  <svg class="leaf" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="6" cy="18" r="2.4" /><circle cx="6" cy="7" r="2.4" /><circle cx="17" cy="11" r="2.4" />
    <path d="M6 9.4v6.2M7.8 8.2 15 10.4" />
  </svg>
{/snippet}

<svelte:window
  onkeydown={(e) => {
    if (
      view === "repo" &&
      (e.ctrlKey || e.metaKey) &&
      (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p")
    ) {
      e.preventDefault();
      finderOpen = true;
    }
  }}
/>

{#if view === "home"}
  <div class="app">
    {#if error}<div class="error">{error}</div>{/if}
    <Picker onopen={openRepo} {leaf} />
  </div>
{:else}
  <div class="app">
    <div class="topbar">
      <button class="brand-btn" onclick={backToPicker} title="Open another repository">
        {@render leaf()} Grove
      </button>
      <div class="repo-chip">
        <span class="name">{repoName}<Copy text={repo.workdir ?? path} title="Copy repo path" /></span>
        {#if repo.head}<span class="branch">{@render leaf()}{repo.head}<Copy text={repo.head} title="Copy branch name" /></span>{/if}
        <span class="count">{commits.length} commits</span>
        {#if live}<span class="live" title="Watching for changes"><span class="live-dot"></span>live</span>{/if}
      </div>
      <span class="legend">
        <span class="lg filled"></span>pushed
        <span class="lg hollow"></span>local
      </span>
      {#if branches.length}
        <BranchPicker
          {branches}
          value={branch}
          onselect={(b) => {
            branch = b;
            onBranchChange();
          }}
        />
      {/if}
      <div class="switcher">
        <button class:on={tab === "graph"} onclick={() => (tab = "graph")}>Graph</button>
        <button class:on={tab === "changes"} onclick={() => (tab = "changes")}>Changes</button>
        <button class:on={tab === "worktrees"} onclick={() => (tab = "worktrees")}>Worktrees</button>
      </div>
      <button class="find-btn" onclick={() => (finderOpen = true)} title="Search files, commits, branches, content">
        Search <kbd>Ctrl K</kbd>
      </button>
      <button class="open-another" onclick={backToPicker}>Open another</button>
    </div>

    {#if tab === "graph"}
      <div class="body">
        <div class="graph-pane">
          <CommitGraph {commits} {selected} {unpushed} onselect={(id) => (selected = id)} />
        </div>
        {#if selected}
          <div class="resizer" onmousedown={startResize} title="Drag to resize"></div>
          <div class="detail-pane" style="width:{detailWidth}px">
            <CommitDetail {path} oid={selected} />
          </div>
        {/if}
      </div>
    {:else if tab === "changes"}
      <div class="body">
        <Changes {path} tick={liveTick} onchanged={refresh} />
      </div>
    {:else}
      <div class="body">
        <Worktrees {path} onopen={openRepo} tick={liveTick} />
      </div>
    {/if}
  </div>
{/if}

{#if finderOpen}
  <Spotlight
    {path}
    {branches}
    {fileIndex}
    onfile={(f) => { fileView = f; finderOpen = false; }}
    oncommit={(oid) => { selected = oid; tab = "graph"; finderOpen = false; }}
    onbranch={(b) => { branch = b; onBranchChange(); finderOpen = false; }}
    onclose={() => (finderOpen = false)}
  />
{/if}
{#if fileView}
  <FileView {path} file={fileView} onclose={() => (fileView = null)} />
{/if}
