<script>
  import { invoke } from "@tauri-apps/api/core";
  import Skeleton from "./Skeleton.svelte";

  // One search for everything: files (any path ever in the repo), commit
  // messages, branches, and file contents.
  let { path, branches = [], onfile, oncommit, onbranch, onclose } = $props();

  let query = $state("");
  let allFiles = $state([]);
  let commitHits = $state([]);
  let contentHits = $state([]);
  let searchingCommits = $state(false);
  let searchingContent = $state(false);
  let highlight = $state(0);
  let inputEl = $state(null);
  let timer = null;

  invoke("all_files", { path }).then((f) => (allFiles = f)).catch(() => {});
  queueMicrotask(() => inputEl?.focus());

  const ICONS = {
    file: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M14 3v5h5"/><path d="M6 3h8l5 5v11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/></svg>`,
    commit: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M3 12h5.8M15.2 12H21"/></svg>`,
    branch: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="6" r="2.3"/><circle cx="6" cy="18" r="2.3"/><circle cx="18" cy="8" r="2.3"/><path d="M6 8.3v7.4M8.2 7 15.6 7.7M18 10.3c0 4-3 4.5-6 4.5"/></svg>`,
    content: `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.3-4.3"/></svg>`,
  };

  function fuzzy(list, q) {
    if (!q) return [];
    const ql = q.toLowerCase();
    const scored = [];
    for (const f of list) {
      const fl = f.toLowerCase();
      let qi = 0;
      let score = 0;
      let last = -2;
      for (let i = 0; i < fl.length && qi < ql.length; i++) {
        if (fl[i] === ql[qi]) {
          score += i === last + 1 ? 3 : 1;
          last = i;
          qi++;
        }
      }
      if (qi === ql.length) {
        const base = f.split(/[\\/]/).pop().toLowerCase();
        scored.push({ f, score: score + (base.includes(ql) ? 12 : 0) - fl.length * 0.01 });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 8).map((s) => s.f);
  }

  const q = $derived(query.trim());
  const branchMatches = $derived(
    q ? branches.filter((b) => b.toLowerCase().includes(q.toLowerCase())).slice(0, 6) : [],
  );
  const fileMatches = $derived(fuzzy(allFiles, q));

  const offFiles = $derived(branchMatches.length);
  const offCommits = $derived(offFiles + fileMatches.length);
  const offContent = $derived(offCommits + commitHits.length);
  const total = $derived(offContent + contentHits.length);

  $effect(() => {
    if (highlight >= total) highlight = Math.max(0, total - 1);
  });

  $effect(() => {
    const term = query;
    clearTimeout(timer);
    if (!term.trim()) {
      commitHits = [];
      contentHits = [];
      searchingCommits = false;
      searchingContent = false;
      return;
    }
    searchingCommits = true;
    searchingContent = true;
    timer = setTimeout(() => {
      invoke("search_commits", { path, query: term })
        .then((c) => (commitHits = c.slice(0, 6)))
        .catch(() => (commitHits = []))
        .finally(() => (searchingCommits = false));
      invoke("grep_repo", { path, query: term })
        .then((h) => (contentHits = h.slice(0, 8)))
        .catch(() => (contentHits = []))
        .finally(() => (searchingContent = false));
    }, 160);
  });

  function selectAt(i) {
    if (i < offFiles) onbranch(branchMatches[i]);
    else if (i < offCommits) onfile(fileMatches[i - offFiles]);
    else if (i < offContent) oncommit(commitHits[i - offCommits].id);
    else onfile(contentHits[i - offContent].file);
  }

  function onKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      highlight = Math.min(highlight + 1, total - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      highlight = Math.max(highlight - 1, 0);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (total) selectAt(highlight);
    } else if (e.key === "Escape") {
      onclose();
    }
  }

  const base = (f) => f.split(/[\\/]/).pop();
  const dir = (f) => f.split(/[\\/]/).slice(0, -1).join("/");
</script>

<div class="gx-modal-bg" onclick={onclose}>
  <div class="sp" onclick={(e) => e.stopPropagation()}>
    <div class="sp-search">
      <span class="sp-sic">{@html ICONS.content}</span>
      <input
        bind:this={inputEl}
        bind:value={query}
        placeholder="Search files, commits, branches, content..."
        onkeydown={onKey}
        spellcheck="false"
      />
    </div>

    <div class="sp-body">
      {#if !q}
        <div class="sp-hint">Search across every file, commit message, branch, and file's contents.</div>
      {:else}
        {#if branchMatches.length}
          <div class="sp-h">Branches</div>
          {#each branchMatches as b, i}
            <button class="sp-row" class:on={highlight === i} onclick={() => selectAt(i)} onmousemove={() => (highlight = i)}>
              <span class="sp-ic">{@html ICONS.branch}</span>
              <span class="sp-main"><span class="sp-title">{b}</span></span>
              <span class="sp-kind">branch</span>
            </button>
          {/each}
        {/if}

        {#if fileMatches.length}
          <div class="sp-h">Files</div>
          {#each fileMatches as f, i}
            {@const idx = offFiles + i}
            <button class="sp-row" class:on={highlight === idx} onclick={() => selectAt(idx)} onmousemove={() => (highlight = idx)}>
              <span class="sp-ic">{@html ICONS.file}</span>
              <span class="sp-main"><span class="sp-title">{base(f)}</span><span class="sp-sub">{dir(f)}</span></span>
              <span class="sp-kind">file</span>
            </button>
          {/each}
        {/if}

        {#if searchingCommits || commitHits.length}
          <div class="sp-h">Commits</div>
          {#if searchingCommits}
            <div class="sp-skel"><Skeleton lines={3} h="36px" gap="6px" r="8px" /></div>
          {:else}
            {#each commitHits as c, i}
              {@const idx = offCommits + i}
              <button class="sp-row" class:on={highlight === idx} onclick={() => selectAt(idx)} onmousemove={() => (highlight = idx)}>
                <span class="sp-ic">{@html ICONS.commit}</span>
                <span class="sp-main"><span class="sp-title">{c.summary}</span><span class="sp-sub">{c.short} · {c.author}</span></span>
                <span class="sp-kind">commit</span>
              </button>
            {/each}
          {/if}
        {/if}

        {#if searchingContent || contentHits.length}
          <div class="sp-h">Content</div>
          {#if searchingContent}
            <div class="sp-skel"><Skeleton lines={4} h="36px" gap="6px" r="8px" /></div>
          {:else}
            {#each contentHits as h, i}
              {@const idx = offContent + i}
              <button class="sp-row" class:on={highlight === idx} onclick={() => selectAt(idx)} onmousemove={() => (highlight = idx)}>
                <span class="sp-ic">{@html ICONS.content}</span>
                <span class="sp-main"><span class="sp-title">{base(h.file)}<span class="sp-ln">:{h.line}</span></span><span class="sp-sub mono">{h.text}</span></span>
                <span class="sp-kind">content</span>
              </button>
            {/each}
          {/if}
        {/if}

        {#if !total && !searchingCommits && !searchingContent}
          <div class="sp-hint">No matches.</div>
        {/if}
      {/if}
    </div>

    <div class="gx-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
      <span><kbd>Enter</kbd> Open</span>
      <span><kbd>Esc</kbd> Close</span>
    </div>
  </div>
</div>
