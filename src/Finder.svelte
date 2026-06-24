<script>
  import { invoke } from "@tauri-apps/api/core";
  import Skeleton from "./Skeleton.svelte";

  let { path, onpick, onclose } = $props();

  let mode = $state("files"); // "files" | "content"
  let query = $state("");
  let files = $state([]);
  let hits = $state([]);
  let highlight = $state(0);
  let inputEl = $state(null);
  let grepTimer = null;
  let searching = $state(false);

  // Load the tracked-file list once; fuzzy filtering happens client-side (fast).
  invoke("list_files", { path })
    .then((f) => (files = f))
    .catch(() => {});

  queueMicrotask(() => inputEl?.focus());

  function fuzzy(list, q) {
    if (!q) return list.slice(0, 60);
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
    return scored.slice(0, 60).map((s) => s.f);
  }

  const fileMatches = $derived(mode === "files" ? fuzzy(files, query.trim()) : []);

  const items = $derived(mode === "files" ? fileMatches : hits);

  $effect(() => {
    if (highlight >= items.length) highlight = Math.max(0, items.length - 1);
  });

  // Debounced content search.
  $effect(() => {
    const q = query;
    if (mode !== "content") return;
    clearTimeout(grepTimer);
    if (!q.trim()) {
      hits = [];
      searching = false;
      return;
    }
    searching = true;
    grepTimer = setTimeout(() => {
      invoke("grep_repo", { path, query: q })
        .then((h) => (hits = h))
        .catch(() => (hits = []))
        .finally(() => (searching = false));
    }, 130);
  });

  function pick(i) {
    const item = items[i];
    if (!item) return;
    onpick(mode === "files" ? item : item.file);
  }

  function setMode(m) {
    mode = m;
    highlight = 0;
    queueMicrotask(() => inputEl?.focus());
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
      pick(highlight);
    } else if (e.key === "Tab") {
      e.preventDefault();
      setMode(mode === "files" ? "content" : "files");
    } else if (e.key === "Escape") {
      onclose();
    }
  }
</script>

<div class="gx-modal-bg" onclick={onclose}>
  <div class="finder" onclick={(e) => e.stopPropagation()}>
    <div class="fnd-head">
      <div class="fnd-tabs">
        <button class:on={mode === "files"} onclick={() => setMode("files")}>Files</button>
        <button class:on={mode === "content"} onclick={() => setMode("content")}>Content</button>
      </div>
      <input
        bind:this={inputEl}
        bind:value={query}
        placeholder={mode === "files" ? "Find a file by name..." : "Search file contents..."}
        onkeydown={onKey}
        spellcheck="false"
      />
    </div>

    <div class="fnd-list">
      {#if mode === "files"}
        {#each fileMatches as f, i}
          <button class="fnd-row" class:on={i === highlight} onclick={() => pick(i)} onmousemove={() => (highlight = i)}>
            <span class="fnd-name">{f.split(/[\\/]/).pop()}</span>
            <span class="fnd-dir">{f.split(/[\\/]/).slice(0, -1).join("/")}</span>
          </button>
        {/each}
        {#if !fileMatches.length}<div class="fnd-empty">{files.length ? "No matching files." : "Loading files..."}</div>{/if}
      {:else if searching}
        <div style="padding:6px"><Skeleton lines={8} h="36px" gap="6px" r="8px" /></div>
      {:else}
        {#each hits as h, i}
          <button class="fnd-row hit" class:on={i === highlight} onclick={() => pick(i)} onmousemove={() => (highlight = i)}>
            <span class="fnd-where"><span class="fnd-name">{h.file.split(/[\\/]/).pop()}</span><span class="fnd-ln">:{h.line}</span></span>
            <span class="fnd-code">{h.text}</span>
          </button>
        {/each}
        {#if !hits.length}<div class="fnd-empty">{query.trim() ? "No matches." : "Type to search contents."}</div>{/if}
      {/if}
    </div>

    <div class="gx-foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
      <span><kbd>Enter</kbd> Open</span>
      <span><kbd>Tab</kbd> {mode === "files" ? "Content" : "Files"}</span>
      <span><kbd>Esc</kbd> Close</span>
    </div>
  </div>
</div>
