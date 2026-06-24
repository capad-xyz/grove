<script>
  import { invoke } from "@tauri-apps/api/core";

  let { path, oid } = $props();

  let detail = $state(null);
  let error = $state("");
  let activeFile = $state(null);
  let diffLines = $state([]);
  let diffLoading = $state(false);

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
      diffLines = parseDiff(patch);
    } catch (e) {
      diffLines = [{ kind: "ctx", oldNo: "", newNo: "", sign: "", text: String(e) }];
    } finally {
      diffLoading = false;
    }
  }

  // Parse a unified diff into rows with old/new line numbers. Noise lines
  // (diff --git, index, ---, +++) are dropped; hunk headers are kept.
  function parseDiff(patch) {
    const rows = [];
    let oldLn = 0;
    let newLn = 0;
    const lines = patch.replace(/\n$/, "").split("\n");
    for (const raw of lines) {
      if (raw.startsWith("@@")) {
        const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
        if (m) {
          oldLn = +m[1];
          newLn = +m[2];
        }
        rows.push({ kind: "hunk", oldNo: "", newNo: "", sign: "", text: raw });
      } else if (
        /^(diff |index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode|\\)/.test(raw)
      ) {
        continue;
      } else if (raw.startsWith("+")) {
        rows.push({ kind: "add", oldNo: "", newNo: newLn++, sign: "+", text: raw.slice(1) });
      } else if (raw.startsWith("-")) {
        rows.push({ kind: "del", oldNo: oldLn++, newNo: "", sign: "-", text: raw.slice(1) });
      } else {
        const t = raw.startsWith(" ") ? raw.slice(1) : raw;
        rows.push({ kind: "ctx", oldNo: oldLn++, newNo: newLn++, sign: "", text: t });
      }
    }
    return rows;
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
          <div class="dl {d.kind}">
            <span class="gut">{d.oldNo}</span>
            <span class="gut">{d.newNo}</span>
            <span class="sign">{d.sign}</span>
            <span class="code">{d.text || " "}</span>
          </div>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="dloading">Loading...</div>
  {/if}
</div>
