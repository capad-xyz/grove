<script>
  import { invoke } from "@tauri-apps/api/core";
  import CommitGraph from "./CommitGraph.svelte";
  import CommitDetail from "./CommitDetail.svelte";
  import Picker from "./Picker.svelte";

  let view = $state("home"); // "home" | "repo"
  let path = $state("");
  let repo = $state(null);
  let commits = $state([]);
  let error = $state("");
  let selected = $state(null);

  const repoName = $derived(
    repo?.workdir ? repo.workdir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "",
  );

  async function openRepo(p) {
    error = "";
    selected = null;
    try {
      repo = await invoke("repo_open", { path: p });
      commits = await invoke("commit_graph", { path: p, limit: 400 });
      path = p;
      view = "repo";
      const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
      invoke("add_recent_repo", { path: p, name }).catch(() => {});
    } catch (e) {
      error = String(e);
      view = "home";
    }
  }

  function backToPicker() {
    view = "home";
    selected = null;
  }
</script>

{#if view === "home"}
  <div class="app">
    {#if error}<div class="error">{error}</div>{/if}
    <Picker onopen={openRepo} />
  </div>
{:else}
  <div class="app">
    <div class="topbar">
      <button class="brand-btn" onclick={backToPicker} title="Open another repository">
        Grove
      </button>
      <div class="repo-chip">
        <span class="name">{repoName}</span>
        {#if repo.head}<span class="branch">{repo.head}</span>{/if}
        <span class="count">{commits.length} commits</span>
      </div>
      <button class="open-another" onclick={backToPicker}>Open another</button>
    </div>

    <div class="body">
      <div class="graph-pane">
        <CommitGraph {commits} {selected} onselect={(id) => (selected = id)} />
      </div>
      {#if selected}
        <div class="detail-pane">
          <CommitDetail {path} oid={selected} />
        </div>
      {/if}
    </div>
  </div>
{/if}
