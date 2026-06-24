<script>
  import { invoke } from "@tauri-apps/api/core";
  import CommitGraph from "./CommitGraph.svelte";

  let path = $state("");
  let repo = $state(null);
  let commits = $state([]);
  let error = $state("");
  let loading = $state(false);
  let selected = $state(null);

  const repoName = $derived(
    repo?.workdir ? repo.workdir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "",
  );

  async function open() {
    if (!path.trim()) return;
    error = "";
    repo = null;
    commits = [];
    selected = null;
    loading = true;
    try {
      repo = await invoke("repo_open", { path });
      commits = await invoke("commit_graph", { path, limit: 400 });
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }
</script>

<div class="app">
  <div class="topbar">
    <div class="brand">Grove</div>
    <input
      bind:value={path}
      placeholder="Paste the path to a git repo"
      onkeydown={(e) => e.key === "Enter" && open()}
      spellcheck="false"
    />
    <button onclick={open} disabled={loading}>
      {loading ? "Opening..." : "Open"}
    </button>
    {#if repo}
      <div class="repo-chip">
        <span class="name">{repoName}</span>
        {#if repo.head}<span class="branch">{repo.head}</span>{/if}
        <span class="count">{commits.length} commits</span>
      </div>
    {/if}
  </div>

  <div class="body">
    {#if error}
      <div class="error">{error}</div>
    {:else if repo}
      <CommitGraph {commits} {selected} onselect={(id) => (selected = id)} />
    {:else}
      <div class="empty">
        <h2>Open a repository</h2>
        <p>Paste a path above to see its commit graph, worktrees, and diffs.</p>
      </div>
    {/if}
  </div>
</div>
