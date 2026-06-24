<script>
  import { invoke } from "@tauri-apps/api/core";
  import DiffView from "./DiffView.svelte";
  import WrapToggle from "./WrapToggle.svelte";
  import Skeleton from "./Skeleton.svelte";
  import Copy from "./Copy.svelte";

  // Large, dedicated diff view for one file of one commit. Lets the user move
  // between the commit's files without leaving the modal.
  let { path, oid, short, files = [], file, onclose } = $props();

  let active = $state(file);
  let patch = $state("");
  let loading = $state(true);
  let error = $state("");

  $effect(() => {
    const f = active;
    loading = true;
    error = "";
    invoke("file_diff", { path, oid, file: f })
      .then((p) => (patch = p))
      .catch((e) => (error = String(e)))
      .finally(() => (loading = false));
  });
</script>

<div class="gx-modal-bg" onclick={onclose}>
  <div class="dm-modal" onclick={(e) => e.stopPropagation()}>
    <div class="dm-head">
      <span class="dm-title">{active}<Copy text={active} title="Copy path" /></span>
      <span class="dm-commit">{short}<Copy text={oid} title="Copy SHA" /></span>
      <WrapToggle />
      <button class="fv-close" onclick={onclose}>Close</button>
    </div>

    <div class="dm-body">
      {#if files.length > 1}
        <div class="dm-files">
          {#each files as f}
            <button
              class="dm-file"
              class:on={active === f.path}
              onclick={() => (active = f.path)}
            >
              <span class="dstatus s-{f.status}">{f.status}</span>
              <span class="dm-fpath">{f.path}</span>
            </button>
          {/each}
        </div>
      {/if}
      <div class="dm-diffwrap">
        {#if error}
          <div class="derror">{error}</div>
        {:else if loading}
          <div class="sk-diff">
            <Skeleton lines={16} h="13px" gap="10px" widths={["94%", "72%", "86%", "60%", "78%", "50%", "90%", "66%", "42%", "82%", "68%", "54%", "88%", "62%", "46%", "76%"]} />
          </div>
        {:else}
          <DiffView {patch} />
        {/if}
      </div>
    </div>
  </div>
</div>
