<script>
  import { invoke } from "@tauri-apps/api/core";
  import DiffView from "./DiffView.svelte";

  let { path, oid } = $props();

  let detail = $state(null);
  let error = $state("");
  let activeFile = $state(null);
  let patch = $state("");
  let diffLoading = $state(false);

  $effect(() => {
    const id = oid;
    detail = null;
    error = "";
    activeFile = null;
    patch = "";
    if (!id) return;
    invoke("commit_detail", { path, oid: id })
      .then((d) => {
        detail = d;
        if (d.files.length) openFile(d.files[0].path);
      })
      .catch((e) => (error = String(e)));
  });

  async function openFile(file) {
    activeFile = file;
    diffLoading = true;
    patch = "";
    try {
      patch = await invoke("file_diff", { path, oid, file });
    } catch (e) {
      patch = "";
      error = String(e);
    } finally {
      diffLoading = false;
    }
  }

  function fmtDate(epoch) {
    return new Date(epoch * 1000).toLocaleString();
  }
  const statusLabel = { A: "added", M: "modified", D: "deleted", R: "renamed", C: "copied" };
</script>

<div class="detail">
  {#if error}
    <div class="derror">{error}</div>
  {:else if detail}
    <div class="dhead">
      <h2>{detail.subject}</h2>
      {#if detail.body}<pre class="dbody">{detail.body}</pre>{/if}
      <div class="dmeta">
        <span class="dauthor">{detail.author}</span>
        <span class="demail">{detail.email}</span>
        <span class="ddate">{fmtDate(detail.date)}</span>
        <span class="dhash">{detail.short}</span>
      </div>
    </div>

    <div class="dfiles">
      {#each detail.files as f}
        <button
          class="dfile"
          class:active={activeFile === f.path}
          onclick={() => openFile(f.path)}
          title={statusLabel[f.status] ?? f.status}
        >
          <span class="dstatus s-{f.status}">{f.status}</span>
          <span class="dpath">{f.path}</span>
          <span class="dstat">
            {#if f.additions}<span class="add">+{f.additions}</span>{/if}
            {#if f.deletions}<span class="del">-{f.deletions}</span>{/if}
          </span>
        </button>
      {/each}
    </div>

    {#if diffLoading}
      <div class="dloading">Loading diff...</div>
    {:else}
      <DiffView {patch} />
    {/if}
  {:else}
    <div class="dloading">Loading...</div>
  {/if}
</div>
