<script>
  // Renders a unified diff with old/new line-number gutters and a single
  // horizontal scroll. Shared by the commit detail panel and the file viewer.
  import { wrapPref } from "./diffwrap.svelte.js";
  let { patch = "", empty = "No changes." } = $props();

  const lines = $derived(parseDiff(patch));

  function parseDiff(p) {
    if (!p) return [];
    const rows = [];
    let oldLn = 0;
    let newLn = 0;
    for (const raw of p.replace(/\n$/, "").split("\n")) {
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
</script>

<div class="ddiff" class:wrap={wrapPref.on}>
  {#if !lines.length}
    <div class="dloading">{empty}</div>
  {:else}
    {#each lines as d}
      <div class="dl {d.kind}">
        <span class="gut">{d.oldNo}</span>
        <span class="gut">{d.newNo}</span>
        <span class="sign">{d.sign}</span>
        <span class="code">{d.text || " "}</span>
      </div>
    {/each}
  {/if}
</div>
