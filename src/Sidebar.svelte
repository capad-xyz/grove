<script>
  // Persistent left rail: the app's spine. Quick-switch repos from anywhere,
  // with the active repo highlighted and a dot for uncommitted changes.
  let { recents = [], activePath = null, dirty = {}, onopen, onsearch, onbrowse, leaf } = $props();

  const norm = (p) => (p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const isActive = (p) => activePath && norm(p) === norm(activePath);

  const folderIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
</script>

<aside class="rail">
  <div class="rail-brand">{@render leaf()} <span>Grove</span> <span class="alpha">ALPHA</span></div>

  <button class="rail-search" onclick={onsearch}>
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
    <span>Search</span><kbd>Ctrl K</kbd>
  </button>

  <div class="rail-label">RECENT REPOS</div>
  <div class="rail-repos">
    {#if recents.length}
      {#each recents as r}
        <button class="rail-repo" class:active={isActive(r.path)} onclick={() => onopen(r.path)} title={r.path}>
          <span class="rr-dot" class:dirty={dirty[r.path]}></span>
          <span class="rr-name">{r.name}</span>
        </button>
      {/each}
    {:else}
      <div class="rail-empty">No projects yet</div>
    {/if}
  </div>

  <button class="rail-open" onclick={onbrowse}>{@html folderIcon} Open repository</button>
  <button class="rail-settings">Settings</button>
</aside>
