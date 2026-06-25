<script>
  import { invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import CommitGraph from "./CommitGraph.svelte";
  import CommitDetail from "./CommitDetail.svelte";
  import Home from "./Home.svelte";
  import OpenModals from "./OpenModals.svelte";
  import Worktrees from "./Worktrees.svelte";
  import Changes from "./Changes.svelte";
  import Spotlight from "./Spotlight.svelte";
  import FileView from "./FileView.svelte";
  import BranchPicker from "./BranchPicker.svelte";
  import NavHub from "./NavHub.svelte";
  import Skeleton from "./Skeleton.svelte";
  import Copy from "./Copy.svelte";

  let view = $state("home"); // "home" | "repo"
  let tab = $state("graph"); // "graph" | "worktrees"
  let path = $state("");
  let repo = $state(null);
  let commits = $state([]);
  let unpushed = $state([]);
  let error = $state("");
  let selected = $state(null);
  let finderOpen = $state(false);
  let fileView = $state(null);
  let live = $state(false);
  let liveTick = $state(0);
  let listening = false;
  let branches = $state([]);
  let branch = $state(""); // "" = all branches
  let headDirty = $state(false); // open repo has uncommitted changes
  let lastRepoPath = $state(""); // for forward-nav (Ctrl+Right) after going home
  let detailWidth = $state(520); // resizable detail/diff pane
  let commitsLoading = $state(false); // graph is fetching commits

  // Browser-style navigation history across home + repos (drives the NavHub).
  let navStack = $state([{ view: "home" }]);
  let navIndex = $state(0);
  let navSuppress = false; // true while applying a back/forward jump

  function recordLoc(loc) {
    if (navSuppress) return;
    const top = navStack[navIndex];
    if (top && top.view === loc.view && top.path === loc.path) return;
    const base = navStack.slice(0, navIndex + 1);
    base.push(loc);
    navStack = base;
    navIndex = base.length - 1;
  }

  function enterHome() {
    if (path) lastRepoPath = path;
    view = "home";
    selected = null;
    finderOpen = false;
    fileView = null;
    live = false;
    invoke("unwatch_repo").catch(() => {});
  }

  async function applyLoc(loc) {
    navSuppress = true;
    try {
      if (loc.view === "home") enterHome();
      else await openRepo(loc.path);
    } finally {
      navSuppress = false;
    }
  }
  function goBack() {
    if (navIndex <= 0) return;
    navIndex -= 1;
    applyLoc(navStack[navIndex]);
  }
  function goForward() {
    if (navIndex >= navStack.length - 1) return;
    navIndex += 1;
    applyLoc(navStack[navIndex]);
  }
  function jumpTo(i) {
    if (i < 0 || i >= navStack.length || i === navIndex) return;
    navIndex = i;
    applyLoc(navStack[i]);
  }

  // Persistent sidebar: recent repos + per-repo dirty state + open-flow modals.
  let recents = $state([]);
  let dirtyMap = $state({});
  let openMode = $state(null); // null | "browse" | "git" | "search"
  let recentsLoaded = false;

  function loadRecents() {
    invoke("recent_repos")
      .then((r) => {
        recents = r;
        for (const repo of r) {
          invoke("repo_dirty", { path: repo.path })
            .then((d) => (dirtyMap = { ...dirtyMap, [repo.path]: d }))
            .catch(() => {});
        }
      })
      .catch(() => {});
  }

  $effect(() => {
    if (recentsLoaded) return;
    recentsLoaded = true;
    loadRecents();
  });

  function startResize(e) {
    e.preventDefault();
    const onMove = (ev) => {
      detailWidth = Math.max(340, Math.min(window.innerWidth - 280, window.innerWidth - ev.clientX));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  // Precomputed file index for instant Spotlight search. Built once per repo
  // (ls-files immediately, the full "every path ever" set in the background)
  // and grown on live-refresh, so it is never re-walked from scratch.
  let fileIndex = $state([]);
  let knownPaths = new Set();

  const buildEntry = (f) => ({
    path: f,
    lower: f.toLowerCase(),
    base: (f.split(/[\\/]/).pop() || "").toLowerCase(),
  });

  function addFiles(files) {
    let added = false;
    for (const f of files) {
      if (f && !knownPaths.has(f)) {
        knownPaths.add(f);
        added = true;
      }
    }
    if (added) fileIndex = Array.from(knownPaths, buildEntry);
  }

  function loadFiles(p) {
    invoke("list_files", { path: p }).then(addFiles).catch(() => {});
    invoke("all_files", { path: p }).then(addFiles).catch(() => {});
  }

  const repoName = $derived(
    repo?.workdir ? repo.workdir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() : "",
  );

  async function openRepo(p) {
    error = "";
    selected = null;
    tab = "graph";
    finderOpen = false;
    fileView = null;
    branch = "";
    knownPaths = new Set();
    fileIndex = [];
    const name = p.replace(/[\\/]+$/, "").split(/[\\/]/).pop();
    try {
      // Open is fast; show the repo shell straight away, then stream the
      // (slower) graph behind a skeleton instead of freezing on the old view.
      repo = await invoke("repo_open", { path: p });
      path = p;
      view = "repo";
      commits = [];
      commitsLoading = true;
      openMode = null;
      recordLoc({ view: "repo", path: p, name });
      commits = await invoke("commit_graph", { path: p, limit: 400, refspec: null });
      commitsLoading = false;
      unpushed = await invoke("unpushed_commits", { path: p }).catch(() => []);
      branches = await invoke("branches", { path: p }).catch(() => []);
      invoke("add_recent_repo", { path: p, name }).catch(() => {});
      invoke("watch_repo", { path: p })
        .then(() => (live = true))
        .catch(() => (live = false));
      invoke("repo_dirty", { path: p }).then((d) => (headDirty = d)).catch(() => {});
      loadFiles(p);
      loadRecents();
    } catch (e) {
      error = String(e);
      view = "home";
      commitsLoading = false;
    }
  }

  function backToPicker() {
    enterHome();
    recordLoc({ view: "home" });
  }

  async function onBranchChange() {
    selected = null;
    try {
      commits = await invoke("commit_graph", { path, limit: 400, refspec: branch || null });
    } catch (e) {
      error = String(e);
    }
  }

  // Re-fetch the repo's data when the watcher reports a change.
  async function refresh() {
    if (view !== "repo" || !path) return;
    try {
      commits = await invoke("commit_graph", { path, limit: 400, refspec: branch || null });
      unpushed = await invoke("unpushed_commits", { path }).catch(() => []);
      repo = await invoke("repo_open", { path });
      invoke("repo_dirty", { path }).then((d) => (headDirty = d)).catch(() => {});
      invoke("list_files", { path }).then(addFiles).catch(() => {}); // pick up new files
      liveTick++; // nudge the worktrees view to reload too
    } catch {}
  }

  $effect(() => {
    if (listening) return;
    listening = true;
    listen("repo-changed", () => refresh());
  });
</script>

{#snippet leaf()}
  <svg class="leaf" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2">
    <circle cx="6" cy="18" r="2.4" /><circle cx="6" cy="7" r="2.4" /><circle cx="17" cy="11" r="2.4" />
    <path d="M6 9.4v6.2M7.8 8.2 15 10.4" />
  </svg>
{/snippet}

<svelte:window
  onkeydown={(e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    const typing = tag === "input" || tag === "textarea" || e.target?.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key.toLowerCase() === "k" || e.key.toLowerCase() === "p")) {
      e.preventDefault();
      finderOpen = true;
    } else if (mod && !typing && e.key === "ArrowLeft") {
      e.preventDefault();
      goBack();
    } else if (mod && !typing && e.key === "ArrowRight") {
      e.preventDefault();
      goForward();
    }
  }}
/>

{#if view === "home"}
  {#if error}<div class="error">{error}</div>{/if}
  <Home {recents} dirty={dirtyMap} onopen={openRepo} onbrowse={() => (openMode = "browse")} ongit={() => (openMode = "git")} onsearch={() => (finderOpen = true)} />
    {:else}
      <div class="app">
        <div class="topbar">
      <button class="nav-home" onclick={backToPicker} title="Back to home (Ctrl+Left)">
        <svg class="chev" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M15 5l-7 7 7 7" /></svg>
        {@render leaf()}
        <span class="nav-word">Grove</span>
        <span class="nav-alpha">ALPHA</span>
      </button>
      <div class="repo-chip">
        <span class="name">{repoName}<Copy text={repo.workdir ?? path} title="Copy repo path" /></span>
        {#if repo.head}<span class="branch">{@render leaf()}{repo.head}<Copy text={repo.head} title="Copy branch name" /></span>{/if}
        <span class="count">{commits.length} commits</span>
        {#if live}<span class="live" title="Watching for changes"><span class="live-dot"></span>live</span>{/if}
      </div>
      <span class="legend">
        <span class="lg filled"></span>pushed
        <span class="lg hollow"></span>local
      </span>
      {#if branches.length}
        <BranchPicker
          {branches}
          value={branch}
          onselect={(b) => {
            branch = b;
            onBranchChange();
          }}
        />
      {/if}
      <div class="switcher">
        <button class:on={tab === "graph"} onclick={() => (tab = "graph")}>Graph</button>
        <button class:on={tab === "changes"} onclick={() => (tab = "changes")}>Changes</button>
        <button class:on={tab === "worktrees"} onclick={() => (tab = "worktrees")}>Worktrees</button>
      </div>
      <button class="find-btn" onclick={() => (finderOpen = true)} title="Search files, commits, branches, content">
        Search <kbd>Ctrl K</kbd>
      </button>
      <button class="open-another" onclick={backToPicker}>Open another</button>
    </div>

    {#if tab === "graph"}
      <div class="body">
        <div class="graph-pane">
          {#if commitsLoading}
            <div class="graph-skel">
              {#each Array(14) as _, i}
                <div class="gs-row">
                  <span class="gs-node"></span>
                  <Skeleton w={`${64 - (i % 5) * 7}%`} h="13px" />
                </div>
              {/each}
            </div>
          {:else}
            <CommitGraph {commits} {selected} {unpushed} dirty={headDirty} onwip={() => (tab = "changes")} onselect={(id) => (selected = id)} />
          {/if}
        </div>
        {#if selected && !commitsLoading}
          <div class="resizer" onmousedown={startResize} title="Drag to resize"></div>
          <div class="detail-pane" style="width:{detailWidth}px">
            <CommitDetail {path} oid={selected} />
          </div>
        {/if}
      </div>
    {:else if tab === "changes"}
      <div class="body">
        <div class="pane"><Changes {path} tick={liveTick} onchanged={refresh} /></div>
      </div>
    {:else}
      <div class="body">
        <div class="pane"><Worktrees {path} onopen={openRepo} tick={liveTick} /></div>
      </div>
    {/if}
      </div>
{/if}

<NavHub
  stack={navStack}
  index={navIndex}
  {recents}
  dirty={dirtyMap}
  onback={goBack}
  onforward={goForward}
  onjump={jumpTo}
  onopen={openRepo}
  onhome={backToPicker}
/>

<OpenModals
  mode={openMode}
  {recents}
  onopen={openRepo}
  onclose={() => (openMode = null)}
  onmode={(m) => (openMode = m)}
/>

{#if finderOpen}
  <Spotlight
    scope={view === "repo" ? "repo" : "projects"}
    {path}
    {branches}
    {fileIndex}
    {recents}
    onfile={(f) => { fileView = f; finderOpen = false; }}
    oncommit={(oid) => { selected = oid; tab = "graph"; finderOpen = false; }}
    onbranch={(b) => { branch = b; onBranchChange(); finderOpen = false; }}
    onopen={(p) => { finderOpen = false; openRepo(p); }}
    onbrowse={() => { finderOpen = false; openMode = "browse"; }}
    ongit={() => { finderOpen = false; openMode = "git"; }}
    onclose={() => (finderOpen = false)}
  />
{/if}
{#if fileView}
  <FileView {path} file={fileView} onclose={() => (fileView = null)} />
{/if}
