<script>
  let { recents = [], dirty = {}, onopen, onbrowse, ongit, onsearch } = $props();

  const ICONS = {
    local: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
    git: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M10.5 13.5a4 4 0 0 0 5.7 0l2-2a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M13.5 10.5a4 4 0 0 0-5.7 0l-2 2a4 4 0 0 0 5.7 5.7l1-1"/></svg>`,
    host: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="9" r="2.3"/><path d="M6 8.3v7.4M8.2 7.1 15.6 8.6"/></svg>`,
  };
  const searchIcon = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>`;

  const SOURCES = [
    { id: "local", label: "Local folder", desc: "Browse a folder on disk" },
    { id: "git", label: "Git URL", desc: "Clone from a remote URL" },
    { id: "github", label: "GitHub", desc: "owner / repo", soon: true },
    { id: "gitlab", label: "GitLab", desc: "group / project", soon: true },
    { id: "azure", label: "Azure DevOps", desc: "project / repository", soon: true },
    { id: "bitbucket", label: "Bitbucket", desc: "workspace / repo", soon: true },
  ];

  function pick(s) {
    if (s.id === "local") onbrowse();
    else if (s.id === "git") ongit();
  }
</script>

<div class="home2">
  <div class="home2-inner">
    <div class="home2-hero">
      <h1>{recents.length ? "Welcome back" : "Welcome to Grove"}</h1>
      <p>A companion for reviewing git changes beside your editor.</p>
    </div>

    <button class="home2-search" onclick={onsearch}>
      <span class="hs-ic">{@html searchIcon}</span>
      <span class="hs-text">Search your projects, files, commits...</span>
      <kbd>Ctrl K</kbd>
    </button>

    {#if recents.length}
      <div class="home2-h">Recent repositories</div>
      <div class="home2-recents">
        {#each recents as r}
          <button class="home2-recent" onclick={() => onopen(r.path)} title={r.path}>
            <span class="rdot" class:dirty={dirty[r.path]}></span>
            <span class="rmain">
              <span class="rname">{r.name}</span>
              <span class="rpath">{r.path}</span>
            </span>
          </button>
        {/each}
      </div>
    {/if}

    <div class="home2-h">Open a repository</div>
    <div class="home2-sources">
      {#each SOURCES as s}
        <button class="home2-src" class:soon={s.soon} onclick={() => pick(s)}>
          <span class="src-ic">{@html ICONS[s.id] ?? ICONS.host}</span>
          <span class="src-main">
            <span class="src-lbl">{s.label}</span>
            <span class="src-ds">{s.desc}</span>
          </span>
          {#if s.soon}<span class="src-soon">soon</span>{/if}
        </button>
      {/each}
    </div>
  </div>
</div>
