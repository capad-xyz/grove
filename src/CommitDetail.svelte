<script>
  import { invoke } from "@tauri-apps/api/core";
  import DiffView from "./DiffView.svelte";
  import Copy from "./Copy.svelte";

  let { path, oid } = $props();

  let detail = $state(null);
  let error = $state("");
  let activeFile = $state(null);
  let patch = $state("");
  let diffLoading = $state(false);
  let copied = $state(false);

  async function writeClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  // One-click: copy the whole commit context (metadata + files + diffs) as
  // markdown, ready to paste into an agent, a PR, or notes.
  async function copyDetails() {
    if (!detail) return;
    const d = detail;
    const out = [`# ${d.subject}`];
    if (d.body) out.push("", d.body);
    out.push(
      "",
      `- Commit: \`${d.id}\``,
      `- Author: ${d.author} <${d.email}>`,
      `- Date: ${new Date(d.date * 1000).toString()}`,
      "",
      `## Changed files (${d.files.length})`,
    );
    for (const f of d.files) {
      out.push(`- ${f.status} \`${f.path}\` (+${f.additions} -${f.deletions})`);
    }
    const diffs = await Promise.all(
      d.files.map((f) =>
        invoke("file_diff", { path, oid: d.id, file: f.path })
          .then((p) => ({ file: f.path, p }))
          .catch(() => ({ file: f.path, p: "" })),
      ),
    );
    out.push("", "## Diff");
    for (const { file, p } of diffs) {
      out.push("", `### ${file}`, "```diff", p.trimEnd(), "```");
    }
    const ok = await writeClipboard(out.join("\n"));
    copied = ok;
    setTimeout(() => (copied = false), 1600);
  }

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
      <div class="dhead-top">
        <h2>{detail.subject}</h2>
        <button class="copy-btn" class:done={copied} onclick={copyDetails} title="Copy message, metadata, and diffs to clipboard">
          {copied ? "Copied" : "Copy details"}
        </button>
      </div>
      {#if detail.body}<pre class="dbody">{detail.body}</pre>{/if}
      <div class="dmeta">
        <span class="dauthor">{detail.author}</span>
        <span class="demail">{detail.email}<Copy text={detail.email} title="Copy email" /></span>
        <span class="ddate">{fmtDate(detail.date)}</span>
        <span class="dhash">{detail.short}<Copy text={detail.id} title="Copy full SHA" /></span>
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
          <Copy text={f.path} title="Copy file path" />
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
