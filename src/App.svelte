<script>
  import { invoke } from "@tauri-apps/api/core";

  // Svelte 5 runes. `let x = $state(...)` is the modern reactive declaration.
  let path = $state("");
  let repo = $state(null);
  let error = $state("");
  let loading = $state(false);

  async function open() {
    if (!path.trim()) return;
    error = "";
    repo = null;
    loading = true;
    try {
      repo = await invoke("repo_open", { path });
    } catch (e) {
      error = String(e);
    } finally {
      loading = false;
    }
  }
</script>

<main>
  <header>
    <h1>Grove</h1>
    <p class="tagline">A git companion that sits beside your editor.</p>
  </header>

  <div class="open-bar">
    <input
      bind:value={path}
      placeholder="Paste the path to a git repo"
      onkeydown={(e) => e.key === "Enter" && open()}
      spellcheck="false"
    />
    <button onclick={open} disabled={loading}>
      {loading ? "Opening..." : "Open"}
    </button>
  </div>

  {#if error}
    <p class="error">{error}</p>
  {/if}

  {#if repo}
    <section class="repo">
      <h2>{repo.head ?? "(detached HEAD)"}</h2>
      <dl>
        <dt>Worktree</dt>
        <dd>{repo.workdir ?? "(bare repository)"}</dd>
        <dt>Git directory</dt>
        <dd>{repo.path}</dd>
        <dt>Bare</dt>
        <dd>{repo.is_bare}</dd>
      </dl>
      <p class="placeholder">
        Commit graph, worktree dashboard, and diff review land here next.
      </p>
    </section>
  {:else if !error}
    <section class="empty">
      <p>Open any folder to see its graph, worktrees, and diffs.</p>
    </section>
  {/if}
</main>
