<script>
  import { invoke } from "@tauri-apps/api/core";
  import DiffView from "./DiffView.svelte";
  import WrapToggle from "./WrapToggle.svelte";
  import Skeleton from "./Skeleton.svelte";
  import Copy from "./Copy.svelte";

  // Large, dedicated diff view for one file of one commit. Lets the user move
  // between the commit's files without leaving the modal, and Ctrl+F to find
  // both files (filters the list) and content (highlights inside the diff).
  let { path, oid, short, files = [], file, onclose } = $props();

  let active = $state(file);
  let patch = $state("");
  let loading = $state(true);
  let error = $state("");

  let findOpen = $state(false);
  let query = $state("");
  let findInput = $state(null);
  let diffEl = $state(null);
  let matchIdx = $state(0);
  let matchCount = $state(0);
  let lastQ = "";

  const q = $derived(query.trim().toLowerCase());
  const shownFiles = $derived(q ? files.filter((f) => f.path.toLowerCase().includes(q)) : files);

  $effect(() => {
    const f = active;
    loading = true;
    error = "";
    invoke("file_diff", { path, oid, file: f })
      .then((p) => (patch = p))
      .catch((e) => (error = String(e)))
      .finally(() => (loading = false));
  });

  // Re-scan the rendered diff for matches whenever the query / file / patch moves.
  $effect(() => {
    query;
    patch;
    active;
    loading;
    refreshMatches();
  });

  function refreshMatches() {
    requestAnimationFrame(() => {
      const els = diffEl ? diffEl.querySelectorAll(".find-line") : [];
      matchCount = els.length;
      if (q !== lastQ) {
        matchIdx = 0;
        lastQ = q;
      }
      if (els.length) {
        if (matchIdx > els.length - 1) matchIdx = 0;
        mark(els);
        els[matchIdx]?.scrollIntoView({ block: "center" });
      }
    });
  }
  function mark(els) {
    els.forEach((el, k) => el.classList.toggle("fh-current", k === matchIdx));
  }
  function go(dir) {
    const els = diffEl ? diffEl.querySelectorAll(".find-line") : [];
    if (!els.length) return;
    matchIdx = (matchIdx + dir + els.length) % els.length;
    mark(els);
    els[matchIdx].scrollIntoView({ block: "center" });
  }

  function openFind() {
    findOpen = true;
    queueMicrotask(() => findInput?.focus());
  }
  function closeFind() {
    findOpen = false;
    query = "";
  }
  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFind();
    } else if (e.key === "Escape") {
      if (findOpen) {
        e.preventDefault();
        e.stopPropagation();
        closeFind();
      } else {
        onclose();
      }
    }
  }
  function findKey(e) {
    if (e.key === "Enter") {
      e.preventDefault();
      go(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeFind();
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="gx-modal-bg" onclick={onclose}>
  <div class="dm-modal" onclick={(e) => e.stopPropagation()}>
    <div class="dm-head">
      <span class="dm-title">{active}<Copy text={active} title="Copy path" /></span>
      <span class="dm-commit">{short}<Copy text={oid} title="Copy SHA" /></span>
      <button class="dm-findbtn" class:on={findOpen} onclick={openFind} title="Find files and content (Ctrl+F)">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
      </button>
      <WrapToggle />
      <button class="fv-close" onclick={onclose}>Close</button>
    </div>

    {#if findOpen}
      <div class="dm-find">
        <svg class="dm-find-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
        <input bind:this={findInput} bind:value={query} placeholder="Find files and diff content..." onkeydown={findKey} spellcheck="false" />
        <span class="dm-find-count">{matchCount ? `${matchIdx + 1} / ${matchCount}` : q ? "no matches" : ""}</span>
        <button class="dm-find-nav" disabled={!matchCount} onclick={() => go(-1)} title="Previous (Shift+Enter)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 14l5-5 5 5" /></svg>
        </button>
        <button class="dm-find-nav" disabled={!matchCount} onclick={() => go(1)} title="Next (Enter)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10l5 5 5-5" /></svg>
        </button>
        <button class="dm-find-nav" onclick={closeFind} title="Close (Esc)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    {/if}

    <div class="dm-body">
      {#if files.length > 1}
        <div class="dm-files">
          {#each shownFiles as f}
            <button class="dm-file" class:on={active === f.path} onclick={() => (active = f.path)}>
              <span class="dstatus s-{f.status}">{f.status}</span>
              <span class="dm-fpath">{f.path}</span>
            </button>
          {/each}
          {#if q && !shownFiles.length}<div class="dm-nofiles">No files match "{query.trim()}".</div>{/if}
        </div>
      {/if}
      <div class="dm-diffwrap" bind:this={diffEl}>
        {#if error}
          <div class="derror">{error}</div>
        {:else if loading}
          <div class="sk-diff">
            <Skeleton lines={16} h="13px" gap="10px" widths={["94%", "72%", "86%", "60%", "78%", "50%", "90%", "66%", "42%", "82%", "68%", "54%", "88%", "62%", "46%", "76%"]} />
          </div>
        {:else}
          <DiffView {patch} file={active} {query} />
        {/if}
      </div>
    </div>
  </div>
</div>
