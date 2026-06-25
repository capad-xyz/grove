<script>
  // Persistent bottom-left navigation hub.
  //  - Left-click the location: a repo switcher (Home pinned on top, then repos).
  //  - Right-click the BACK arrow: the places behind you (closest first).
  //  - Right-click the FORWARD arrow: the places ahead of you.
  //  - The arrows themselves step one at a time.
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

  let menu = $state(null); // null | "switch" | "back" | "forward"

  const canBack = $derived(index > 0);
  const canForward = $derived(index >= 0 && index < stack.length - 1);
  const current = $derived(stack[index] ?? null);

  // Behind you, closest first. Ahead of you, in order.
  const backList = $derived(stack.slice(0, Math.max(0, index)).map((loc, i) => ({ loc, i })).reverse());
  const fwdList = $derived(stack.slice(index + 1).map((loc, k) => ({ loc, i: index + 1 + k })));

  const label = (loc) => (loc?.view === "repo" ? loc.name : "Home");
  const TAB = { graph: "Graph", changes: "Changes", worktrees: "Worktrees" };
  const tabName = (loc) => (loc?.view === "repo" && loc.tab ? TAB[loc.tab] ?? "" : "");

  function openSwitch(e) {
    e.preventDefault();
    e.stopPropagation();
    menu = menu === "switch" ? null : "switch";
  }
  function openBack(e) {
    e.preventDefault();
    e.stopPropagation();
    if (canBack) menu = "back";
  }
  function openForward(e) {
    e.preventDefault();
    e.stopPropagation();
    if (canForward) menu = "forward";
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

{#snippet locIcon(loc)}
  {#if loc.view === "repo"}
    <svg class="nh-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="6" cy="6" r="2.3" /><circle cx="6" cy="18" r="2.3" /><circle cx="18" cy="9" r="2.3" /><path d="M6 8.3v7.4M8.2 7.1 15.6 8.6" /></svg>
  {:else}
    <svg class="nh-ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11.5 12 4l9 7.5" /><path d="M5 10v9h14v-9" /></svg>
  {/if}
{/snippet}

<svelte:window onkeydown={(e) => e.key === "Escape" && (menu = null)} />

<div class="navhub">
  {#if menu}
    <div class="nh-scrim" onclick={() => (menu = null)} oncontextmenu={(e) => { e.preventDefault(); menu = null; }}></div>
  {/if}

  {#if menu === "switch"}
    <div class="nh-menu nh-menu-switch">
      <div class="nh-menu-h">Switch to</div>
      <div class="nh-menu-list">
        <button class="nh-item" class:on={current?.view === "home"} onclick={pickHome}>
          {@render locIcon({ view: "home" })}
          <span class="nh-lbl">Home</span>
        </button>
        <div class="nh-divider"></div>
        {#each recents as r (r.path)}
          <button class="nh-item" class:on={current?.view === "repo" && current.path === r.path} onclick={() => pickRepo(r.path)} title={r.path}>
            {@render locIcon({ view: "repo" })}
            <span class="nh-lbl">{r.name}</span>
            {#if dirty[r.path]}<span class="nh-dirty" title="Uncommitted changes"></span>{/if}
          </button>
        {/each}
        {#if !recents.length}<div class="nh-empty">No projects yet</div>{/if}
      </div>
    </div>
  {:else if menu === "back"}
    <div class="nh-menu nh-menu-back">
      <div class="nh-menu-h">Back</div>
      <div class="nh-menu-list">
        {#each backList as e (e.i)}
          <button class="nh-item" onclick={() => jump(e.i)}>
            {@render locIcon(e.loc)}
            <span class="nh-lbl">{label(e.loc)}</span>
            {#if tabName(e.loc)}<span class="nh-tab">{tabName(e.loc)}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {:else if menu === "forward"}
    <div class="nh-menu nh-menu-fwd">
      <div class="nh-menu-h">Forward</div>
      <div class="nh-menu-list">
        {#each fwdList as e (e.i)}
          <button class="nh-item" onclick={() => jump(e.i)}>
            {@render locIcon(e.loc)}
            <span class="nh-lbl">{label(e.loc)}</span>
            {#if tabName(e.loc)}<span class="nh-tab">{tabName(e.loc)}</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <div class="nh-bar">
    <button class="nh-btn" disabled={!canBack} onclick={onback} oncontextmenu={openBack} title="Back  (Ctrl+Left)  ·  right-click for history">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7" /></svg>
    </button>
    <button class="nh-btn" disabled={!canForward} onclick={onforward} oncontextmenu={openForward} title="Forward  (Ctrl+Right)  ·  right-click for history">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7" /></svg>
    </button>
    <div class="nh-sep"></div>
    <button class="nh-loc" onclick={openSwitch} oncontextmenu={openSwitch} title="Switch project">
      <span class="nh-dot" class:repo={current?.view === "repo"}></span>
      <span class="nh-name">{current ? label(current) : "Grove"}</span>
      {#if tabName(current)}<span class="nh-tab">{tabName(current)}</span>{/if}
      <svg class="nh-caret" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 14l5-5 5 5" /></svg>
    </button>
  </div>
</div>
