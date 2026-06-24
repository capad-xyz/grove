<script>
  import { invoke } from "@tauri-apps/api/core";

  let { path, oid } = $props();

  let detail = $state(null);
  let error = $state("");
  let activeFile = $state(null);
  let diffLines = $state([]);
  let diffLoading = $state(false);

  // Reload whenever the selected commit changes.
  $effect(() => {
    const id = oid;
    detail = null;
    error = "";
    activeFile = null;
    diffLines = [];
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
    diffLines = [];
    try {
      const patch = await invoke("file_diff", { path, oid, file });
      diffLines = patch.split("\n").map((line) => ({ line, kind: kindOf(line) }));
    } catch (e) {
      diffLines = [{ line: String(e), kind: "meta" }];
    } finally {
      diffLoading = false;
    }
  }

  function kindOf(l) {
    if (l.startsWith("@@")) return "hunk";
    if (l.startsWith("+++") || l.startsWith("---")) return "meta";
    if (l.startsWith("diff ") || l.startsWith("index ")) return "meta";
    if (l.startsWith("+")) return "add";
    if (l.startsWith("-")) return "del";
    return "ctx";
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

    <div class="ddiff">
      {#if diffLoading}
        <div class="dloading">Loading diff...</div>
      {:else}
        {#each diffLines as d}
          <div class="dl {d.kind}">{d.line || " "}</div>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="dloading">Loading...</div>
  {/if}
</div>
