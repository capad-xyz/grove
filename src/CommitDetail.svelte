<script>
  import { invoke } from "@tauri-apps/api/core";
  import DiffView from "./DiffView.svelte";
  import DiffModal from "./DiffModal.svelte";
  import WrapToggle from "./WrapToggle.svelte";
  import Skeleton from "./Skeleton.svelte";
  import Copy from "./Copy.svelte";

  let { path, oid } = $props();

  let detail = $state(null);
  let error = $state("");
  let activeFile = $state(null);
  let patch = $state("");
  let diffLoading = $state(false);
  let copied = $state(false);
  let expand = $state(false);

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
        <div class="dm-line">
          <span class="dm-author">{detail.author}</span>
          <span class="dm-date">{fmtDate(detail.date)}</span>
        </div>
        <div class="dm-line">
          <span class="dm-email">{detail.email}</span>
          <Copy text={detail.email} title="Copy email" />
        </div>
        <div class="dm-line">
          <span class="dm-hash">{detail.short}</span>
          <Copy text={detail.id} title="Copy full SHA" />
        </div>
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

    {#if activeFile}
      <div class="ddiff-head">
        <span class="ddiff-file" title={activeFile}>{activeFile}</span>
        <WrapToggle />
        <button class="ddiff-expand" onclick={() => (expand = true)} title="Open in full view">
          Expand
        </button>
      </div>
    {/if}
    {#if diffLoading}
      <div class="sk-diff">
        <Skeleton lines={12} h="12px" gap="9px" widths={["92%", "70%", "84%", "58%", "76%", "48%", "88%", "64%", "40%", "80%", "66%", "52%"]} />
      </div>
    {:else}
      <DiffView {patch} file={activeFile} />
    {/if}
  {:else}
    <div class="dhead">
      <Skeleton w="82%" h="16px" />
      <div style="height:14px"></div>
      <Skeleton lines={3} h="11px" gap="8px" widths={["55%", "42%", "28%"]} />
    </div>
    <div class="dfiles">
      <Skeleton lines={4} h="14px" gap="16px" widths={["68%", "54%", "62%", "40%"]} />
    </div>
    <div class="sk-diff">
      <Skeleton lines={8} h="12px" gap="9px" widths={["90%", "66%", "82%", "54%", "74%", "46%", "86%", "60%"]} />
    </div>
  {/if}
</div>

{#if expand && activeFile && detail}
  <DiffModal
    {path}
    oid={detail.id}
    short={detail.short}
    files={detail.files}
    file={activeFile}
    onclose={() => (expand = false)}
  />
{/if}
