<script>
  import { invoke } from "@tauri-apps/api/core";
  import DiffView from "./DiffView.svelte";

  let { path, file, onclose } = $props();

  let history = $state([]);
  let fromRev = $state("");
  let toRev = $state("");
  let patch = $state("");
  let error = $state("");
  let loading = $state(true);

  $effect(() => {
    const f = file;
    loading = true;
    error = "";
    history = [];
    invoke("file_history", { path, file: f })
      .then((h) => {
        history = h;
        if (h.length) selectCommit(0);
        else {
          loading = false;
          error = "No history for this file.";
        }
      })
      .catch((e) => {
        loading = false;
        error = String(e);
      });
  });

  // Show what a given commit changed in this file (commit vs its parent).
  function selectCommit(idx) {
    toRev = history[idx].id;
    fromRev = history[idx + 1]?.id ?? history[idx].id + "~1";
    loadDiff();
  }

  async function loadDiff() {
    loading = true;
    error = "";
    try {
      patch = await invoke("file_diff_between", { path, a: fromRev, b: toRev, file });
    } catch (e) {
      patch = "";
      error = String(e);
    } finally {
      loading = false;
    }
  }

  const shortRev = (r) => (r.length > 12 ? r.slice(0, 7) : r);
</script>

<div class="gx-modal-bg" onclick={onclose}>
  <div class="fv" onclick={(e) => e.stopPropagation()}>
    <div class="fv-head">
      <span class="fv-path">{file}</span>
      <button class="fv-close" onclick={onclose}>Close</button>
    </div>

    <div class="fv-body">
      <div class="fv-history">
        <div class="fv-h">History</div>
        {#each history as c, i}
          <button class="fv-commit" class:on={toRev === c.id} onclick={() => selectCommit(i)}>
            <span class="fv-sum">{c.summary}</span>
            <span class="fv-sub"><span class="fv-hash">{c.short}</span> {c.author}</span>
          </button>
        {/each}
      </div>

      <div class="fv-diff">
        <div class="fv-compare">
          <span>Compare</span>
          <select bind:value={fromRev} onchange={loadDiff}>
            {#each history as c}<option value={c.id}>{c.short} — {c.summary}</option>{/each}
          </select>
          <span class="fv-arrow">to</span>
          <select bind:value={toRev} onchange={loadDiff}>
            {#each history as c}<option value={c.id}>{c.short} — {c.summary}</option>{/each}
          </select>
        </div>
        {#if error}
          <div class="derror">{error}</div>
        {:else if loading}
          <div class="dloading">Loading diff...</div>
        {:else}
          <DiffView {patch} empty="No differences between {shortRev(fromRev)} and {shortRev(toRev)}." />
        {/if}
      </div>
    </div>
  </div>
</div>
