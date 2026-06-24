<script>
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import CommitGraph from "./CommitGraph.svelte";
  import CommitDetail from "./CommitDetail.svelte";
  import Picker from "./Picker.svelte";
  import Worktrees from "./Worktrees.svelte";
  import Finder from "./Finder.svelte";
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
    if (view === "repo" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p") {
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
        <button class:on={tab === "worktrees"} onclick={() => (tab = "worktrees")}>Worktrees</button>
      </div>
      <button class="find-btn" onclick={() => (finderOpen = true)} title="Find file or content">
        Find <kbd>Ctrl P</kbd>
      </button>
      <button class="open-another" onclick={backToPicker}>Open another</button>
    </div>

    {#if tab === "graph"}
      <div class="body">
        <div class="graph-pane">
          <CommitGraph {commits} {selected} {unpushed} onselect={(id) => (selected = id)} />
        </div>
        {#if selected}
          <div class="detail-pane">
            <CommitDetail {path} oid={selected} />
          </div>
        {/if}
      </div>
    {:else}
      <div class="body">
        <Worktrees {path} onopen={openRepo} tick={liveTick} />
      </div>
    {/if}
  </div>
{/if}

{#if finderOpen}
  <Finder {path} onpick={(f) => { fileView = f; finderOpen = false; }} onclose={() => (finderOpen = false)} />
{/if}
{#if fileView}
  <FileView {path} file={fileView} onclose={() => (fileView = null)} />
{/if}
