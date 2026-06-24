<script>
  import { invoke } from "@tauri-apps/api/core";

  let { onopen, leaf } = $props();

  let recents = $state([]);
  let mode = $state("home"); // "home" | "browse" | "git"
  let started = false;

  // browse state
  let listing = $state(null);
  let query = $state("");
  let highlight = $state(0);
  let browseErr = $state("");
  let searchEl = $state(null);

  // git state
  let gitUrl = $state("");
  let gitErr = $state("");
  let busy = $state(false);

  const SOURCES = [
    { id: "local", label: "Local folder", desc: "Browse a folder on disk" },
    { id: "git", label: "Git URL", desc: "Clone from a remote URL" },
    { id: "github", label: "GitHub", desc: "owner / repo", soon: true },
    { id: "gitlab", label: "GitLab", desc: "group / project", soon: true },
    { id: "azure", label: "Azure DevOps", desc: "project / repository", soon: true },
    { id: "bitbucket", label: "Bitbucket", desc: "workspace / repo", soon: true },
  ];

  const ICONS = {
    local: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
    git: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2 2a4 4 0 0 0 5.7 5.7l1-1"/></svg>`,
    host: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="9" r="2.3"/><path d="M6 8.3v7.4M8.2 7.1 15.6 8.6"/></svg>`,
  };
  const folderIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  const repoIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="9" r="2.3"/><path d="M6 8.3v7.4M8.2 7.1 15.6 8.6"/></svg>`;
  const upIcon = `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 19V7M6 12l6-6 6 6"/></svg>`;
  const searchIcon = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;

  $effect(() => {
    if (started) return;
    started = true;
    invoke("recent_repos").then((r) => (recents = r)).catch(() => {});
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

  $effect(() => {
    if (highlight >= items.length) highlight = Math.max(0, items.length - 1);
  });

  async function startBrowse() {
    mode = "browse";
    query = "";
    highlight = 0;
    browseErr = "";
    await navigate("");
    queueMicrotask(() => searchEl?.focus());
  }

  function startGit() {
    mode = "git";
    gitErr = "";
    queueMicrotask(() => searchEl?.focus());
  }

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
      const p = await invoke("clone_repo", { url: gitUrl.trim() });
      onopen(p);
    } catch (e) {
      gitErr = String(e);
    } finally {
      busy = false;
    }
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
      mode = "home";
    }
  }

  const crumb = $derived(
    (listing?.current ?? "").split(/[\\/]/).filter(Boolean).slice(-5).join("  /  "),
  );

  // ---- Home quick-open search (recents + actions) ----
  let sQuery = $state("");
  let sHighlight = $state(0);
  let sEl = $state(null);

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
    if (sHighlight >= sItems.length) sHighlight = Math.max(0, sItems.length - 1);
  });

  function openSearch() {
    mode = "search";
    sQuery = "";
    sHighlight = 0;
    queueMicrotask(() => sEl?.focus());
  }

  function activateSearch(item) {
    if (!item) return;
    if (item.kind === "repo") onopen(item.path);
    else if (item.kind === "browse") startBrowse();
    else if (item.kind === "git") startGit();
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
      mode = "home";
    }
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (mode === "home" && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openSearch();
    }
  }}
/>

<div class="home">
  <aside class="gx-side">
    <div class="gx-brand">{@render leaf()} Grove <span class="alpha">ALPHA</span></div>
    <button class="gx-search-btn" onclick={openSearch}>
      <span>Search projects</span><kbd>Ctrl K</kbd>
    </button>
    <button class="gx-new" onclick={startBrowse}>{@html folderIcon} Open repository</button>
    <div class="gx-projlabel">PROJECTS</div>
    <div class="gx-projects">
      {#if recents.length}
        {#each recents as r}
          <button class="gx-proj" onclick={() => onopen(r.path)} title={r.path}>
            <span class="dot"></span>{r.name}
          </button>
        {/each}
      {:else}
        <div class="gx-side-empty">No projects yet</div>
      {/if}
    </div>
    <button class="gx-settings">Settings</button>
  </aside>

  <main class="gx-main">
    <div class="gx-canvas">
      <div class="gx-hero">
        <h1>{recents.length ? "Welcome back" : "Welcome to Grove"}</h1>
        <p>Open a repository to explore its graph, worktrees, and diffs.</p>
      </div>

      <button class="gx-herosearch" onclick={openSearch}>
        <span class="gx-hs-ic">{@html searchIcon}</span>
        <span class="gx-hs-text">Search your projects, or open a repository...</span>
        <kbd>Ctrl K</kbd>
      </button>

      {#if recents.length}
        <div class="gx-h">Jump back in</div>
        <div class="gx-recents">
          {#each recents as r}
            <button class="gx-card" onclick={() => onopen(r.path)}>
              <span class="ttl"><span class="dot"></span>{r.name}</span>
              <span class="sub">{r.path}</span>
            </button>
          {/each}
        </div>
      {/if}

      <div class="gx-h">Open from</div>
      <div class="gx-sources">
        {#each SOURCES as s}
          <button
            class="gx-src"
            class:soon={s.soon}
            onclick={() => (s.id === "local" ? startBrowse() : s.id === "git" ? startGit() : null)}
          >
            <span class="gx-ic">{@html ICONS[s.id] ?? ICONS.host}</span>
            <span>
              <span class="lbl">{s.label}</span>
              <span class="ds">{s.desc}</span>
            </span>
            {#if s.soon}<span class="gx-soon">soon</span>{/if}
          </button>
        {/each}
      </div>
    </div>
  </main>
</div>

{#if mode === "browse"}
  <div class="gx-modal-bg" onclick={() => (mode = "home")}>
    <div class="gx-modal" onclick={(e) => e.stopPropagation()}>
      <div class="gx-mhead">
        <button class="gx-mback" onclick={() => (mode = "home")} title="Close">‹</button>
        <input
          bind:this={searchEl}
          bind:value={query}
          placeholder="Filter folders..."
          onkeydown={onKey}
          spellcheck="false"
        />
      </div>
      <div class="gx-crumb">{crumb || listing?.current}</div>
      {#if browseErr}
        <div class="gx-merr">{browseErr}</div>
      {:else}
        <div class="gx-list">
          {#each items as item, i}
            <button
              class="gx-row"
              class:on={i === highlight}
              class:repo={item.is_repo}
              onclick={() => activate(item)}
              onmousemove={() => (highlight = i)}
            >
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
  <div class="gx-modal-bg" onclick={() => (mode = "home")}>
    <div class="gx-modal" onclick={(e) => e.stopPropagation()}>
      <div class="gx-mhead">
        <button class="gx-mback" onclick={() => (mode = "home")} title="Close">‹</button>
        <input
          bind:this={searchEl}
          bind:value={gitUrl}
          placeholder="https://github.com/owner/repo.git"
          onkeydown={(e) => (e.key === "Enter" ? doClone() : e.key === "Escape" ? (mode = "home") : null)}
          spellcheck="false"
        />
      </div>
      <button class="gx-mbtn" onclick={doClone}>{busy ? "Cloning..." : "Clone into ~/GroveRepos"}</button>
      {#if gitErr}<div class="gx-merr">{gitErr}</div>{/if}
    </div>
  </div>
{:else if mode === "search"}
  <div class="gx-modal-bg" onclick={() => (mode = "home")}>
    <div class="gx-modal" onclick={(e) => e.stopPropagation()}>
      <div class="gx-mhead">
        <button class="gx-mback" onclick={() => (mode = "home")} title="Close">‹</button>
        <input
          bind:this={sEl}
          bind:value={sQuery}
          placeholder="Search projects or actions..."
          onkeydown={sKey}
          spellcheck="false"
        />
      </div>
      <div class="gx-list">
        {#each sItems as item, i}
          <button
            class="gx-row"
            class:on={i === sHighlight}
            class:repo={item.kind === "repo"}
            onclick={() => activateSearch(item)}
            onmousemove={() => (sHighlight = i)}
          >
            <span class="ic">{@html item.kind === "repo" ? repoIcon : item.kind === "browse" ? folderIcon : ICONS.git}</span>
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
