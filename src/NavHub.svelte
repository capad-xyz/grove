<script>
  // Persistent bottom-left navigation hub: browser-style back/forward across the
  // places you've visited (home and repos), plus a right-click travel-history
  // menu to jump anywhere in the stack.
  let { stack = [], index = -1, onback, onforward, onjump } = $props();

  let menu = $state(false);

  const canBack = $derived(index > 0);
  const canForward = $derived(index >= 0 && index < stack.length - 1);
  const current = $derived(stack[index] ?? null);

  const label = (loc) => (loc?.view === "repo" ? loc.name : "Home");

  function openMenu(e) {
    e.preventDefault();
    if (stack.length) menu = true;
  }
  function jump(i) {
    menu = false;
    onjump(i);
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (menu = false)} />

<div class="navhub">
  {#if menu}
    <div class="nh-scrim" onclick={() => (menu = false)} oncontextmenu={(e) => { e.preventDefault(); menu = false; }}></div>
    <div class="nh-menu">
      <div class="nh-menu-h">Travel history</div>
      <div class="nh-menu-list">
        {#each stack as loc, i (i)}
          <button class="nh-item" class:on={i === index} onclick={() => jump(i)}>
            {#if loc.view === "repo"}
              <svg class="nh-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="2.3" /><circle cx="6" cy="18" r="2.3" /><circle cx="18" cy="9" r="2.3" /><path d="M6 8.3v7.4M8.2 7.1 15.6 8.6" /></svg>
            {:else}
              <svg class="nh-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9h14v-9" /></svg>
            {/if}
            <span class="nh-lbl">{label(loc)}</span>
            {#if i === index}<span class="nh-now">here</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="nh-bar" oncontextmenu={openMenu} title="Right-click for travel history">
    <button class="nh-btn" disabled={!canBack} onclick={onback} title="Back  (Ctrl+Left)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <button class="nh-btn" disabled={!canForward} onclick={onforward} title="Forward  (Ctrl+Right)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7" /></svg>
    </button>
    <div class="nh-sep"></div>
    <button class="nh-loc" onclick={openMenu} oncontextmenu={openMenu} title="Right-click for travel history">
      <span class="nh-dot" class:repo={current?.view === "repo"}></span>
      <span class="nh-name">{current ? label(current) : "Grove"}</span>
      <svg class="nh-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 14l5-5 5 5" /></svg>
    </button>
  </div>
</div>
