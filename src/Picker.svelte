<script>
  import { invoke } from "@tauri-apps/api/core";

  let { onopen } = $props();

  let recents = $state([]);
  let paletteOpen = $state(true);
  let step = $state("sources"); // "sources" | "folder" | "git"
  let query = $state("");
  let highlight = $state(0);

  let listing = $state(null);
  let gitUrl = $state("");
  let busy = $state(false);
  let error = $state("");
  let searchEl = $state(null);
  let started = false;

  const SOURCES = [
    { id: "local", label: "Local folder", desc: "Browse a folder on disk" },
    { id: "git", label: "Git URL", desc: "Clone from a remote URL" },
    { id: "azure", label: "Azure DevOps repository", desc: "Clone Azure project/repository", setup: true },
    { id: "bitbucket", label: "Bitbucket repository", desc: "Clone Bitbucket workspace/repository", setup: true },
    { id: "github", label: "GitHub repository", desc: "Clone GitHub owner/repo", setup: true },
    { id: "gitlab", label: "GitLab repository", desc: "Clone GitLab group/project", setup: true },
  ];

  $effect(() => {
    if (started) return;
    started = true;
    invoke("recent_repos").then((r) => (recents = r)).catch(() => {});
  });

  const q = $derived(query.trim().toLowerCase());

  const items = $derived.by(() => {
    if (step === "sources") {
      return SOURCES.filter(
        (s) => !q || s.label.toLowerCase().includes(q) || s.desc.toLowerCase().includes(q),
      );
    }
    if (step === "folder" && listing) {
      const list = [];
      if (listing.parent) list.push({ kind: "up", label: ".. (up a level)", path: listing.parent });
      for (const e of listing.entries) {
        if (!q || e.name.toLowerCase().includes(q)) list.push({ kind: "dir", ...e });
      }
      return list;
    }
    return [];
  });

  // Keep the highlight within range whenever the list changes.
  $effect(() => {
    if (highlight >= items.length) highlight = Math.max(0, items.length - 1);
  });

  async function openPalette() {
    paletteOpen = true;
    step = "sources";
    query = "";
    highlight = 0;
    error = "";
    queueMicrotask(() => searchEl?.focus());
  }

  async function navigate(path) {
    error = "";
    query = "";
    highlight = 0;
    try {
      listing = await invoke("list_dir", { path });
      step = "folder";
    } catch (e) {
      error = String(e);
    }
  }

  async function chooseSource(s) {
    if (s.setup) return;
    if (s.id === "local") navigate("");
    else if (s.id === "git") {
      step = "git";
      query = "";
      error = "";
    }
  }

  function activate(item) {
    if (step === "sources") chooseSource(item);
    else if (step === "folder") {
      if (item.kind === "up") navigate(item.path);
      else if (item.is_repo) onopen(item.path);
      else navigate(item.path);
    }
  }

  async function doClone() {
    if (!gitUrl.trim()) return;
    busy = true;
    error = "";
    try {
      const path = await invoke("clone_repo", { url: gitUrl.trim() });
      onopen(path);
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  function back() {
    error = "";
    query = "";
    if (step === "folder" && listing?.parent) navigate(listing.parent);
    else {
      step = "sources";
      highlight = 0;
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
      if (items[highlight]) activate(items[highlight]);
    } else if (e.key === "Backspace" && !query) {
      e.preventDefault();
      back();
    } else if (e.key === "Escape") {
      if (step !== "sources") back();
    }
  }

  $effect(() => {
    if (paletteOpen) queueMicrotask(() => searchEl?.focus());
  });

  const placeholder = $derived(
    step === "sources" ? "Search sources..." : step === "folder" ? "Filter folders..." : "",
  );
</script>

<svelte:window
  onkeydown={(e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openPalette();
    }
  }}
/>

<div class="home">
  <aside class="sidebar">
    <div class="side-brand">Grove <span class="alpha">ALPHA</span></div>
    <button class="side-search" onclick={openPalette}>
      <span>Search</span><kbd>Ctrl K</kbd>
    </button>
    <div class="side-projects">
      <div class="side-h">
        <span>PROJECTS</span>
        <button class="side-add" onclick={openPalette} title="Add a repository">+</button>
      </div>
      {#if recents.length}
        {#each recents as r}
          <button class="side-proj" onclick={() => onopen(r.path)} title={r.path}>
            <span class="sp-dot"></span>{r.name}
          </button>
        {/each}
      {:else}
        <div class="side-empty">No projects yet</div>
      {/if}
    </div>
    <button class="side-settings">Settings</button>
  </aside>

  <main class="home-main">
    {#if paletteOpen}
      <div class="palette">
        {#if step === "git"}
          <div class="pal-search">
            <button class="pal-back" onclick={back} title="Back">‹</button>
            <input
              bind:this={searchEl}
              bind:value={gitUrl}
              placeholder="https://github.com/owner/repo.git"
              onkeydown={(e) => {
                if (e.key === "Enter") doClone();
                else if (e.key === "Escape") back();
              }}
              spellcheck="false"
            />
          </div>
          <div class="pal-body">
            <div class="pal-section">Clone</div>
            <button class="pal-row selected" onclick={doClone}>
              <div class="pal-main">
                <div class="pal-label">{busy ? "Cloning..." : "Clone repository"}</div>
                <div class="pal-desc">Into ~/GroveRepos, then open it</div>
              </div>
            </button>
            {#if error}<div class="pal-error">{error}</div>{/if}
          </div>
        {:else}
          <div class="pal-search">
            <button class="pal-back" onclick={back} title="Back">‹</button>
            <input
              bind:this={searchEl}
              bind:value={query}
              placeholder={placeholder}
              onkeydown={onKey}
              spellcheck="false"
            />
          </div>
          <div class="pal-body">
            <div class="pal-section">
              {step === "sources" ? "Sources" : listing?.current}
            </div>
            {#each items as item, i}
              <button
                class="pal-row"
                class:selected={i === highlight}
                class:disabled={item.setup}
                onclick={() => activate(item)}
                onmousemove={() => (highlight = i)}
              >
                <span class="pal-icon" class:repo={item.is_repo} class:up={item.kind === "up"}></span>
                <div class="pal-main">
                  <div class="pal-label">{item.label ?? item.name}</div>
                  {#if item.desc}<div class="pal-desc">{item.desc}</div>{/if}
                </div>
                {#if item.setup}
                  <span class="pal-badge">Setup Required</span>
                {:else if item.is_repo}
                  <span class="pal-open">open</span>
                {/if}
              </button>
            {/each}
            {#if !items.length}
              <div class="pal-empty">Nothing here.</div>
            {/if}
            {#if error}<div class="pal-error">{error}</div>{/if}
          </div>
        {/if}

        <div class="pal-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span><kbd>Enter</kbd> Select</span>
          <span><kbd>Backspace</kbd> Back</span>
          <span><kbd>Esc</kbd> Close</span>
        </div>
      </div>
    {:else}
      <div class="home-empty">
        <p>No repository open.</p>
        <button class="home-open" onclick={openPalette}>Open a repository</button>
      </div>
    {/if}
  </main>
</div>
