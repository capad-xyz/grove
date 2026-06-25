<script>
  // Renders a unified diff with old/new line-number gutters and a single
  // horizontal scroll. Shared by the commit detail panel and the file viewer.
  import { wrapPref } from "./diffwrap.svelte.js";
  import { langFor, highlightLine } from "./highlight.js";
  let { patch = "", empty = "No changes.", file = "", query = "" } = $props();

  const lang = $derived(langFor(file));

  const lines = $derived(parseDiff(patch));
  const q = $derived(query.trim());
  const ql = $derived(q.toLowerCase());

  const escHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const matches = (d) => ql && d.kind !== "hunk" && d.text.toLowerCase().includes(ql);

  // Wrap each occurrence of the query in the line with a <mark>, escaping the
  // surrounding text (we drop syntax colour on hit lines, which is fine).
  function findHl(text) {
    const lower = text.toLowerCase();
    let i = 0;
    let from = 0;
    let out = "";
    while ((i = lower.indexOf(ql, from)) !== -1) {
      out += escHtml(text.slice(from, i)) + '<mark class="fh">' + escHtml(text.slice(i, i + q.length)) + "</mark>";
      from = i + q.length;
    }
    out += escHtml(text.slice(from));
    return out;
  }

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
      <div class="dl {d.kind}" class:find-line={matches(d)}>
        <span class="gut">{d.oldNo}</span>
        <span class="gut">{d.newNo}</span>
        <span class="sign">{d.sign}</span>
        <span class="code">{#if d.kind === "hunk"}{d.text}{:else if matches(d)}{@html findHl(d.text)}{:else}{@html highlightLine(d.text, lang)}{/if}</span>
      </div>
    {/each}
  {/if}
</div>
