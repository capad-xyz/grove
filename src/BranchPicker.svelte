<script>
  // Searchable branch dropdown. "" = all branches.
  let { branches = [], value = "", onselect } = $props();

  let open = $state(false);
  let query = $state("");
  let highlight = $state(0);
  let inputEl = $state(null);
  let rootEl = $state(null);

  const options = $derived(["", ...branches]);
  const filtered = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => (o === "" ? "all branches" : o.toLowerCase()).includes(q));
  });

  $effect(() => {
    if (highlight >= filtered.length) highlight = Math.max(0, filtered.length - 1);
  });

  const label = (o) => (o === "" ? "All branches" : o);

  function toggle() {
    open = !open;
    if (open) {
      query = "";
      highlight = Math.max(0, options.indexOf(value));
      queueMicrotask(() => inputEl?.focus());
    }
  }

  function choose(o) {
    open = false;
    onselect(o);
  }

  function onKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight = Math.min(highlight + 1, filtered.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight = Math.max(highlight - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[highlight] !== undefined) choose(filtered[highlight]);
    } else if (e.key === "Escape") {
      open = false;
    }
  }
</script>

<svelte:window
  onclick={(e) => {
    if (open && rootEl && !rootEl.contains(e.target)) open = false;
  }}
/>

<div class="bp" bind:this={rootEl}>
  <button class="bp-btn" onclick={toggle} title="Filter the graph by branch">
    <span class="bp-val">{label(value)}</span>
    <svg class="bp-caret" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 9l6 6 6-6" />
    </svg>
  </button>

  {#if open}
    <div class="bp-pop">
      <input
        class="bp-search"
        bind:this={inputEl}
        bind:value={query}
        placeholder="Search branches..."
        onkeydown={onKey}
        spellcheck="false"
      />
      <div class="bp-list">
        {#each filtered as o, i}
          <button
            class="bp-opt"
            class:on={i === highlight}
            class:active={o === value}
            onclick={() => choose(o)}
            onmousemove={() => (highlight = i)}
          >
            {label(o)}
          </button>
        {/each}
        {#if !filtered.length}<div class="bp-empty">No matching branches</div>{/if}
      </div>
    </div>
  {/if}
</div>
