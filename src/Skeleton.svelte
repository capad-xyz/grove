<script>
  // Shimmer placeholder. Pass `lines` > 1 with optional `widths` for a stack
  // that mimics the shape of the content it stands in for (avoids layout jump).
  let {
    w = "100%",
    h = "13px",
    r = "6px",
    lines = 1,
    gap = "10px",
    widths = null,
  } = $props();

  const widthFor = (i) => (widths ? widths[i % widths.length] : w);
</script>

{#if lines > 1}
  <div class="skel-stack" style="gap:{gap}">
    {#each Array(lines) as _, i}
      <div class="skel" style="height:{h};border-radius:{r};width:{widthFor(i)}"></div>
    {/each}
  </div>
{:else}
  <div class="skel" style="width:{w};height:{h};border-radius:{r}"></div>
{/if}
