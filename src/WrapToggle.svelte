<script>
  import { wrapPref } from "./diffwrap.svelte.js";
</script>

<button
  class="wrap-toggle"
  class:on={wrapPref.on}
  onclick={() => (wrapPref.on = !wrapPref.on)}
  title="Toggle line wrapping"
>
  Wrap
</button>
