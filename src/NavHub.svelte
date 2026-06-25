<script>
  // Persistent bottom-left navigation hub.
  //  - Left-click the location: a repo switcher (Home pinned on top, then repos).
  //  - Right-click anywhere: browser-style back/forward travel history.
  //  - The arrows step through that history.
  let {
    stack = [],
    index = -1,
    recents = [],
    dirty = {},
    onback,
    onforward,
    onjump,
    onopen,
    onhome,
  } = $props();

  let menu = $state(null); // null | "switch" | "history"

  const canBack = $derived(index > 0);
  const canForward = $derived(index >= 0 && index < stack.length - 1);
  const current = $derived(stack[index] ?? null);

  const label = (loc) => (loc?.view === "repo" ? loc.name : "Home");
  const isHere = (loc) =>
    current && current.view === loc.view && (loc.view !== "repo" || current.path === loc.path);

  function openSwitch(e) {
    e.preventDefault();
    e.stopPropagation();
    menu = menu === "switch" ? null : "switch";
  }
  function openHistory(e) {
    e.preventDefault();
    e.stopPropagation();
    if (stack.length) menu = "history";
  }
  function pickRepo(p) {
    menu = null;
    onopen(p);
  }
  function pickHome() {
    menu = null;
    onhome();
  }
  function jump(i) {
    menu = null;
    onjump(i);
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && (menu = null)} />

<div class="navhub">
  {#if menu}
    <div class="nh-scrim" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
  {/if}

  {#if menu === "switch"}
    <div class="nh-menu">
      <div class="nh-menu-h">Switch to</div>
      <div class="nh-menu-list">
        <button class="nh-item" class:on={current?.view === "home"} onclick={pickHome}>
          <svg class="nh-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9h14v-9" /></svg>
          <span class="nh-lbl">Home</span>
        </button>
        <div class="nh-divider"></div>
        {#each recents as r (r.path)}
          <button class="nh-item" class:on={current?.view === "repo" && current.path === r.path} onclick={() => pickRepo(r.path)} title={r.path}>
            <svg class="nh-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="2.3" /><circle cx="6" cy="18" r="2.3" /><circle cx="18" cy="9" r="2.3" /><path d="M6 8.3v7.4M8.2 7.1 15.6 8.6" /></svg>
            <span class="nh-lbl">{r.name}</span>
            {#if dirty[r.path]}<span class="nh-dirty" title="Uncommitted changes"></span>{/if}
          </button>
        {/each}
        {#if !recents.length}<div class="nh-empty">No projects yet</div>{/if}
      </div>
    </div>
  {:else if menu === "history"}
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

  <div class="nh-bar" oncontextmenu={openHistory} title="Right-click for back / forward history">
    <button class="nh-btn" disabled={!canBack} onclick={onback} oncontextmenu={openHistory} title="Back  (Ctrl+Left)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <button class="nh-btn" disabled={!canForward} onclick={onforward} oncontextmenu={openHistory} title="Forward  (Ctrl+Right)">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7" /></svg>
    </button>
    <div class="nh-sep"></div>
    <button class="nh-loc" onclick={openSwitch} oncontextmenu={openHistory} title="Switch project (right-click for history)">
      <span class="nh-dot" class:repo={current?.view === "repo"}></span>
      <span class="nh-name">{current ? label(current) : "Grove"}</span>
      <svg class="nh-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 14l5-5 5 5" /></svg>
    </button>
  </div>
</div>
