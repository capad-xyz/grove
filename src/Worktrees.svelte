<script>
  import { invoke } from "@tauri-apps/api/core";

  let { path, onopen } = $props();

  let list = $state([]);
  let error = $state("");
  let loading = $state(true);

  $effect(() => {
    const p = path;
    loading = true;
    error = "";
    invoke("worktrees", { path: p })
      .then((w) => (list = w))
      .catch((e) => (error = String(e)))
      .finally(() => (loading = false));
  });
</script>

<div class="wt">
  <div class="wt-head">
    <h2>Worktrees</h2>
    <span class="n">{list.length} linked working {list.length === 1 ? "tree" : "trees"}</span>
  </div>

  {#if error}
    <div class="derror">{error}</div>
  {:else if loading}
    <div class="dloading">Loading worktrees...</div>
  {:else}
    <div class="wt-grid">
      {#each list as w}
        <div class="wt-card">
          <div class="wt-top">
            <span class="wt-branch">
              {w.branch ?? (w.detached ? "detached HEAD" : "unknown")}
            </span>
            {#if w.is_main}<span class="wt-main-tag">main</span>{/if}
          </div>

          <div class="wt-badges">
            <span class="wt-badge {w.dirty ? 'dirty' : 'clean'}">
              {w.dirty ? "uncommitted changes" : "clean"}
            </span>
            {#if w.has_upstream && (w.ahead || w.behind)}
              <span class="wt-badge">
                {#if w.ahead}<span class="ah">{w.ahead} ahead</span>{/if}
                {#if w.behind}<span class="bh">{w.behind} behind</span>{/if}
              </span>
            {/if}
          </div>

          <div class="wt-path">{w.path}</div>

          <div class="wt-foot">
            <span class="wt-hash">{w.head}</span>
            <button class="wt-open" onclick={() => onopen(w.path)}>Open</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
