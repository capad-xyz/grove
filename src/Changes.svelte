<script>
  import { invoke } from "@tauri-apps/api/core";
  import DiffView from "./DiffView.svelte";
  import Skeleton from "./Skeleton.svelte";

  let { path, tick = 0, onchanged } = $props();

  let status = $state(null);
  let loading = $state(true);
  let error = $state("");

  let sel = $state(null); // { file, group }
  let patch = $state("");
  let untracked = $state("");
  let diffLoading = $state(false);

  let message = $state("");
  let committing = $state(false);
  let generating = $state(false);

  async function generate() {
    generating = true;
    error = "";
    try {
      message = await invoke("generate_commit_message", { path });
    } catch (e) {
      error = String(e);
    } finally {
      generating = false;
    }
  }

  const statusLabel = { M: "modified", A: "added", D: "deleted", R: "renamed", C: "copied", "?": "untracked" };

  // Reload status on open and whenever live refresh ticks.
  $effect(() => {
    const p = path;
    tick;
    loading = true;
    error = "";
    invoke("working_status", { path: p })
      .then((s) => {
        status = s;
        // keep the current selection valid, else clear the diff
        if (sel && !stillPresent(s, sel)) {
          sel = null;
          patch = "";
          untracked = "";
        } else if (sel) {
          loadDiff(sel);
        }
      })
      .catch((e) => (error = String(e)))
      .finally(() => (loading = false));
  });

  function stillPresent(s, sel) {
    if (sel.group === "untracked") return s.untracked.includes(sel.file);
    const list = sel.group === "staged" ? s.staged : s.unstaged;
    return list.some((f) => f.path === sel.file);
  }

  async function select(file, group) {
    sel = { file, group };
    await loadDiff(sel);
  }

  async function loadDiff(s) {
    diffLoading = true;
    patch = "";
    untracked = "";
    try {
      if (s.group === "untracked") {
        untracked = await invoke("working_file", { path, file: s.file });
      } else {
        patch = await invoke("working_diff", { path, file: s.file, staged: s.group === "staged" });
      }
    } catch (e) {
      patch = "";
    } finally {
      diffLoading = false;
    }
  }

  async function reload() {
    try {
      status = await invoke("working_status", { path });
    } catch {}
  }

  async function act(cmd, args) {
    try {
      await invoke(cmd, { path, ...args });
      await reload();
      onchanged?.();
    } catch (e) {
      error = String(e);
    }
  }

  const stage = (file) => act("stage_file", { file });
  const unstage = (file) => act("unstage_file", { file });
  const stageAll = () => act("stage_all", {});
  const unstageAll = () => act("unstage_all", {});

  const canCommit = $derived(!!status?.staged.length && message.trim().length > 0 && !committing);

  async function commit() {
    if (!canCommit) return;
    committing = true;
    error = "";
    try {
      await invoke("commit_changes", { path, message: message.trim() });
      message = "";
      sel = null;
      patch = "";
      await reload();
      onchanged?.();
    } catch (e) {
      error = String(e);
    } finally {
      committing = false;
    }
  }

  const clean = $derived(
    status && !status.staged.length && !status.unstaged.length && !status.untracked.length,
  );
</script>

<div class="ch">
  <div class="ch-side">
    {#if loading && !status}
      <div style="padding:12px"><Skeleton lines={6} h="20px" gap="10px" r="6px" /></div>
    {:else if error}
      <div class="derror">{error}</div>
    {:else if clean}
      <div class="ch-clean">Working tree clean. Nothing to commit.</div>
    {:else}
      {#if status.staged.length}
        <div class="ch-group">
          <div class="ch-h">
            <span>Staged ({status.staged.length})</span>
            <button class="ch-allbtn" onclick={unstageAll}>Unstage all</button>
          </div>
          {#each status.staged as f}
            <div class="ch-row" class:on={sel?.group === "staged" && sel.file === f.path}>
              <button class="ch-file" onclick={() => select(f.path, "staged")} title={statusLabel[f.status] ?? f.status}>
                <span class="dstatus s-{f.status}">{f.status}</span>
                <span class="ch-path">{f.path}</span>
              </button>
              <button class="ch-act" title="Unstage" onclick={() => unstage(f.path)}>−</button>
            </div>
          {/each}
        </div>
      {/if}

      {#if status.unstaged.length}
        <div class="ch-group">
          <div class="ch-h">
            <span>Changes ({status.unstaged.length})</span>
            <button class="ch-allbtn" onclick={stageAll}>Stage all</button>
          </div>
          {#each status.unstaged as f}
            <div class="ch-row" class:on={sel?.group === "unstaged" && sel.file === f.path}>
              <button class="ch-file" onclick={() => select(f.path, "unstaged")} title={statusLabel[f.status] ?? f.status}>
                <span class="dstatus s-{f.status}">{f.status}</span>
                <span class="ch-path">{f.path}</span>
              </button>
              <button class="ch-act" title="Stage" onclick={() => stage(f.path)}>+</button>
            </div>
          {/each}
        </div>
      {/if}

      {#if status.untracked.length}
        <div class="ch-group">
          <div class="ch-h">
            <span>Untracked ({status.untracked.length})</span>
            <button class="ch-allbtn" onclick={stageAll}>Stage all</button>
          </div>
          {#each status.untracked as f}
            <div class="ch-row" class:on={sel?.group === "untracked" && sel.file === f}>
              <button class="ch-file" onclick={() => select(f, "untracked")} title="untracked">
                <span class="dstatus s-A">U</span>
                <span class="ch-path">{f}</span>
              </button>
              <button class="ch-act" title="Stage" onclick={() => stage(f)}>+</button>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    {#if status?.staged.length}
      <div class="ch-commit">
        <div class="ch-commit-head">
          <span>Commit message</span>
          <button class="ch-gen" onclick={generate} disabled={generating} title="Generate a message from the staged diff with your local agent">
            {generating ? "Generating..." : "Generate with agent"}
          </button>
        </div>
        <textarea bind:value={message} placeholder="Write a message, or generate one from the staged diff" rows="3" spellcheck="false"></textarea>
        <button class="ch-commitbtn" disabled={!canCommit} onclick={commit}>
          {committing ? "Committing..." : `Commit ${status.staged.length} file${status.staged.length === 1 ? "" : "s"}`}
        </button>
      </div>
    {/if}
  </div>

  <div class="ch-diff">
    {#if diffLoading}
      <div class="sk-diff"><Skeleton lines={12} h="12px" gap="9px" widths={["92%", "70%", "84%", "58%", "76%", "48%", "88%", "64%", "40%", "80%", "66%", "52%"]} /></div>
    {:else if sel?.group === "untracked"}
      <div class="ch-untracked"><div class="ch-untag">New file</div><pre>{untracked}</pre></div>
    {:else if sel}
      <DiffView {patch} file={sel.file} empty="No changes to show." />
    {:else}
      <div class="ch-empty">Select a file to see its changes.</div>
    {/if}
  </div>
</div>
