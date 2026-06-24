<script>
  import { copy } from "./copy.js";

  // Renders as a <span> (not <button>) so it can safely nest inside clickable
  // rows. Stops propagation so copying never triggers the row's own action.
  let { text = "", title = "Copy", label = "" } = $props();
  let done = $state(false);

  async function go(e) {
    e.stopPropagation();
    e.preventDefault();
    if (await copy(text)) {
      done = true;
      setTimeout(() => (done = false), 1200);
    }
  }
</script>

<span
  class="copy-ic"
  class:done
  role="button"
  tabindex="0"
  title={done ? "Copied" : title}
  onclick={go}
  onkeydown={(e) => (e.key === "Enter" || e.key === " ") && go(e)}
>
  {#if done}
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2">
      <path d="M5 12.5l4 4L19 7" />
    </svg>
  {:else}
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8">
      <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" />
    </svg>
  {/if}
  {#if label}<span class="copy-lbl">{label}</span>{/if}
</span>
