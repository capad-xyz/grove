<script>
  import { invoke } from "@tauri-apps/api/core";

  // mode: null | "browse" | "git" | "search". Controlled by the parent so the
  // sidebar (or the home launcher) can open any of these from anywhere.
  let { mode = null, recents = [], onopen, onclose, onmode } = $props();

  const folderIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const repoIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="9" r="2.3"/><path d="M6 8.3v7.4M8.2 7.1 15.6 8.6"/></svg>`;
  const upIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 19V7M6 12l6-6 6 6"/></svg>`;
  const gitIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2 2a4 4 0 0 0 5.7 5.7l1-1"/></svg>`;

  let listing = $state(null);
  let query = $state("");
  let highlight = $state(0);
  let browseErr = $state("");
  let inputEl = $state(null);

  let gitUrl = $state("");
  let gitErr = $state("");
  let busy = $state(false);

  let sQuery = $state("");
  let sHighlight = $state(0);

  // Initialize whenever the mode changes.
  let lastMode = null;
  $effect(() => {
    const m = mode;
    if (m === lastMode) return;
    lastMode = m;
    if (m === "browse") {
      query = "";
      highlight = 0;
      browseErr = "";
      navigate("");
      queueMicrotask(() => inputEl?.focus());
    } else if (m === "git") {
      gitUrl = "";
      gitErr = "";
      queueMicrotask(() => inputEl?.focus());
    } else if (m === "search") {
      sQuery = "";
      sHighlight = 0;
      queueMicrotask(() => inputEl?.focus());
    }
  });

  const items = $derived.by(() => {
    if (mode !== "browse" || !listing) return [];
    const q = query.trim().toLowerCase();
    const list = [];
    if (listing.parent) list.push({ kind: "up", name: ".. up a level", path: listing.parent });
    for (const e of listing.entries) {
      if (!q || e.name.toLowerCase().includes(q)) list.push({ kind: "dir", ...e });
    }
    return list;
  });

  const sItems = $derived.by(() => {
    if (mode !== "search") return [];
    const q = sQuery.trim().toLowerCase();
    const repos = recents
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q))
      .map((r) => ({ kind: "repo", name: r.name, sub: r.path, path: r.path }));
    const actions = [
      { kind: "browse", name: "Browse a folder", sub: "Open a local repository" },
      { kind: "git", name: "Clone from Git URL", sub: "Clone a remote repository" },
    ].filter((a) => !q || a.name.toLowerCase().includes(q));
    return [...repos, ...actions];
  });

  $effect(() => {
    if (highlight >= items.length) highlight = Math.max(0, items.length - 1);
  });
  $effect(() => {
    if (sHighlight >= sItems.length) sHighlight = Math.max(0, sItems.length - 1);
  });

  async function navigate(path) {
    browseErr = "";
    query = "";
    highlight = 0;
    try {
      listing = await invoke("list_dir", { path });
    } catch (e) {
      browseErr = String(e);
    }
  }

  function activate(item) {
    if (!item) return;
    if (item.kind === "up") navigate(item.path);
    else if (item.is_repo) onopen(item.path);
    else navigate(item.path);
  }

  async function doClone() {
    if (!gitUrl.trim()) return;
    busy = true;
    gitErr = "";
    try {
      onopen(await invoke("clone_repo", { url: gitUrl.trim() }));
    } catch (e) {
      gitErr = String(e);
    } finally {
      busy = false;
    }
  }

  function activateSearch(item) {
    if (!item) return;
    if (item.kind === "repo") onopen(item.path);
    else if (item.kind === "browse") onmode("browse");
    else if (item.kind === "git") onmode("git");
  }

  function onKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight = Math.min(highlight + 1, items.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight = Math.max(highlight - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activate(items[highlight]);
    } else if (e.key === "Backspace" && !query) {
      e.preventDefault();
      if (listing?.parent) navigate(listing.parent);
    } else if (e.key === "Escape") {
      onclose();
    }
  }

  function sKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      sHighlight = Math.min(sHighlight + 1, sItems.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      sHighlight = Math.max(sHighlight - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      activateSearch(sItems[sHighlight]);
    } else if (e.key === "Escape") {
      onclose();
    }
  }

  const crumb = $derived(
    (listing?.current ?? "").split(/[\\/]/).filter(Boolean).slice(-5).join("  /  "),
  );
</script>

{#if mode === "browse"}
  <div class="gx-modal-bg" onclick={onclose}>
    <div class="gx-modal" onclick={(e) => e.stopPropagation()}>
      <div class="gx-mhead">
        <button class="gx-mback" onclick={onclose} title="Close">‹</button>
        <input bind:this={inputEl} bind:value={query} placeholder="Filter folders..." onkeydown={onKey} spellcheck="false" />
      </div>
      <div class="gx-crumb">{crumb || listing?.current}</div>
      {#if browseErr}
        <div class="gx-merr">{browseErr}</div>
      {:else}
        <div class="gx-list">
          {#each items as item, i}
            <button class="gx-row" class:on={i === highlight} class:repo={item.is_repo} onclick={() => activate(item)} onmousemove={() => (highlight = i)}>
              <span class="ic">{@html item.kind === "up" ? upIcon : item.is_repo ? repoIcon : folderIcon}</span>
              <span class="nm">{item.name}</span>
              {#if item.is_repo}<span class="open">open</span>{/if}
            </button>
          {/each}
          {#if !items.length}<div class="gx-side-empty">Nothing here.</div>{/if}
        </div>
      {/if}
      <div class="gx-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>Enter</kbd> Open</span>
        <span><kbd>Bksp</kbd> Up</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    </div>
  </div>
{:else if mode === "git"}
  <div class="gx-modal-bg" onclick={onclose}>
    <div class="gx-modal" onclick={(e) => e.stopPropagation()}>
      <div class="gx-mhead">
        <button class="gx-mback" onclick={onclose} title="Close">‹</button>
        <input bind:this={inputEl} bind:value={gitUrl} placeholder="https://github.com/owner/repo.git" onkeydown={(e) => (e.key === "Enter" ? doClone() : e.key === "Escape" ? onclose() : null)} spellcheck="false" />
      </div>
      <button class="gx-mbtn" onclick={doClone}>{busy ? "Cloning..." : "Clone into ~/GroveRepos"}</button>
      {#if gitErr}<div class="gx-merr">{gitErr}</div>{/if}
    </div>
  </div>
{:else if mode === "search"}
  <div class="gx-modal-bg" onclick={onclose}>
    <div class="gx-modal" onclick={(e) => e.stopPropagation()}>
      <div class="gx-mhead">
        <button class="gx-mback" onclick={onclose} title="Close">‹</button>
        <input bind:this={inputEl} bind:value={sQuery} placeholder="Search projects or actions..." onkeydown={sKey} spellcheck="false" />
      </div>
      <div class="gx-list">
        {#each sItems as item, i}
          <button class="gx-row" class:on={i === sHighlight} class:repo={item.kind === "repo"} onclick={() => activateSearch(item)} onmousemove={() => (sHighlight = i)}>
            <span class="ic">{@html item.kind === "repo" ? repoIcon : item.kind === "browse" ? folderIcon : gitIcon}</span>
            <span class="gx-rowmain">
              <span class="gx-rowname">{item.name}</span>
              <span class="gx-rowsub">{item.sub}</span>
            </span>
          </button>
        {/each}
        {#if !sItems.length}<div class="gx-side-empty">No matches</div>{/if}
      </div>
      <div class="gx-foot">
        <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
        <span><kbd>Enter</kbd> Open</span>
        <span><kbd>Esc</kbd> Close</span>
      </div>
    </div>
  </div>
{/if}
