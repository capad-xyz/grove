<script>
  // Renders a commit graph: an SVG of lanes/nodes on the left, aligned with a
  // column of commit rows on the right. Lane layout is computed once over the
  // topologically-ordered commits; rendering is virtualized so only the rows and
  // graph elements in (or near) the viewport are in the DOM, which keeps huge
  // histories smooth to scroll.
  let { commits = [], selected = null, onselect = () => {}, unpushed = [], dirty = false, onwip = () => {} } = $props();
  const unpushedSet = $derived(new Set(unpushed));

  import Copy from "./Copy.svelte";

  const ROW = 34; // px per commit row (must match --row in styles.css)
  const LANE = 18; // px per graph lane
  const PAD = 18; // left padding before lane 0
  const R = 5; // node radius

  // Warm, Claude-flavoured lane palette.
  const LANE_COLORS = [
    "#d98763", // clay
    "#6ab0a6", // teal
    "#c7a667", // sand
    "#7e9cc4", // slate blue
    "#b483b0", // mauve
    "#90b56f", // sage
    "#d98763",
  ];
  const laneColor = (i) => LANE_COLORS[i % LANE_COLORS.length];

  const x = (lane) => PAD + lane * LANE;

  const layout = $derived.by(() => {
    const rowOf = new Map();
    commits.forEach((c, i) => rowOf.set(c.id, i));

    const lanes = []; // lanes[k] = commit id this lane currently expects
    const placed = [];
    let maxLane = 0;

    for (let i = 0; i < commits.length; i++) {
      const c = commits[i];

      // All lanes waiting for this commit converge here. Take the leftmost as
      // this node's lane and free the rest (the merge collapses them).
      const mine = [];
      for (let k = 0; k < lanes.length; k++) if (lanes[k] === c.id) mine.push(k);
      let lane;
      if (mine.length) {
        lane = mine[0];
        for (let m = 1; m < mine.length; m++) lanes[mine[m]] = null;
      } else {
        lane = lanes.indexOf(null);
        if (lane === -1) {
          lane = lanes.length;
          lanes.push(null);
        }
      }
      lanes[lane] = null; // reset; first parent may reclaim it below

      const parentLanes = [];
      c.parents.forEach((p, pi) => {
        // Reuse the lane already reserved for this parent, so an id never
        // occupies two lanes (that was the leak).
        let pl = lanes.indexOf(p);
        if (pl === -1) {
          if (pi === 0) {
            pl = lane; // first parent continues this node's lane
          } else {
            pl = lanes.indexOf(null);
            if (pl === -1) {
              pl = lanes.length;
              lanes.push(null);
            }
          }
          lanes[pl] = p;
        }
        parentLanes.push(pl);
      });

      maxLane = Math.max(maxLane, lane, ...parentLanes);
      placed.push({ commit: c, lane, parentLanes, i });
    }

    // When the working tree is dirty, reserve the top row for a WIP node that
    // sits on HEAD's lane and feeds down into it. Everything else shifts down.
    const off = dirty && commits.length ? 1 : 0;
    const yy = (i) => ROW / 2 + (i + off) * ROW;

    const laneCount = maxLane + 1;
    const height = (commits.length + off) * ROW;
    const edges = [];
    for (const r of placed) {
      const x1 = x(r.lane);
      const y1 = yy(r.i);
      r.commit.parents.forEach((p, pi) => {
        const pl = r.parentLanes[pi];
        const x2 = x(pl);
        const j = rowOf.get(p);
        const color = laneColor(pl);
        if (j === undefined) {
          // Parent outside the loaded window: trail off the bottom.
          edges.push({ d: `M ${x1} ${y1} L ${x2} ${height}`, color, top: Math.min(y1, height), bot: Math.max(y1, height) });
        } else {
          const y2 = yy(j);
          const d =
            x1 === x2
              ? `M ${x1} ${y1} L ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1} ${y1 + ROW * 0.6}, ${x2} ${y2 - ROW * 0.6}, ${x2} ${y2}`;
          edges.push({ d, color, top: Math.min(y1, y2), bot: Math.max(y1, y2) });
        }
      });
    }

    const nodes = placed.map((r) => ({
      x: x(r.lane),
      y: yy(r.i),
      color: laneColor(r.lane),
      commit: r.commit,
    }));

    // The WIP node + its connector into HEAD (the first placed commit).
    let wip = null;
    if (off) {
      const headLane = placed[0].lane;
      const wx = x(headLane);
      wip = { x: wx, y: ROW / 2, edge: `M ${wx} ${ROW / 2} L ${wx} ${yy(0)}`, color: laneColor(headLane) };
    }

    const width = PAD + laneCount * LANE + PAD;
    return { nodes, edges, width, height, wip, off };
  });

  // --- Virtualization: track the scroll viewport, render only what's near it ---
  let scroller = $state(null);
  let scrollTop = $state(0);
  let viewH = $state(900);
  let raf = 0;

  // Coalesce rapid scroll events to one update per frame so fast flicks don't
  // flood the main thread with re-derivations.
  function onScroll() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (scroller) scrollTop = scroller.scrollTop;
    });
  }

  $effect(() => {
    const el = scroller;
    if (!el) return;
    const measure = () => {
      viewH = el.clientHeight;
      scrollTop = el.scrollTop;
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };
  });

  const BUF = 14; // rows of overscan above/below the viewport (smooths fast scroll)
  const visTop = $derived(scrollTop - ROW * BUF);
  const visBot = $derived(scrollTop + viewH + ROW * BUF);
  const first = $derived(Math.max(0, Math.floor(scrollTop / ROW) - layout.off - BUF));
  const last = $derived(Math.min(commits.length, Math.ceil((scrollTop + viewH) / ROW) - layout.off + BUF));
  const visRows = $derived.by(() => {
    const out = [];
    for (let i = first; i < last; i++) out.push({ c: commits[i], i });
    return out;
  });
  // Nodes are in commit order, so slice directly (O(visible)) instead of scanning
  // all of them every frame. Edges can span far, so keep a range overlap test.
  const visNodes = $derived(layout.nodes.slice(first, last));
  const visEdges = $derived(layout.edges.filter((e) => e.bot >= visTop && e.top <= visBot));

  function rel(epoch) {
    const s = Math.max(0, Math.floor(Date.now() / 1000 - epoch));
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h`;
    const d = Math.floor(h / 24);
    if (d < 30) return `${d}d`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo}mo`;
    return `${Math.floor(mo / 12)}y`;
  }

  function refClass(r) {
    if (r === "HEAD") return "head";
    if (r.includes("/")) return "remote";
    return "";
  }
</script>

<div class="graph" bind:this={scroller} onscroll={onScroll} style="--row:{ROW}px">
  <div class="graph-canvas" style="height:{layout.height}px">
    <svg class="lanes" width={layout.width} height={layout.height} style="min-width:{layout.width}px">
      {#each visEdges as e}
        <path d={e.d} stroke={e.color} fill="none" stroke-width="2" />
      {/each}
      {#if layout.wip}
        <path d={layout.wip.edge} stroke={layout.wip.color} fill="none" stroke-width="2" stroke-dasharray="3 3" opacity="0.8" />
        <circle cx={layout.wip.x} cy={layout.wip.y} r={R} fill="#121317" stroke={layout.wip.color} stroke-width="2" stroke-dasharray="2.4 2.2" />
      {/if}
      {#each visNodes as n (n.commit.id)}
        {#if n.commit.id === selected}
          <circle cx={n.x} cy={n.y} r={R + 3.5} fill="none" stroke={n.color} stroke-width="2" opacity="0.55" />
        {/if}
        {#if unpushedSet.has(n.commit.id)}
          <circle cx={n.x} cy={n.y} r={R} fill="#121317" stroke={n.color} stroke-width="2" />
        {:else}
          <circle cx={n.x} cy={n.y} r={R} fill={n.color} stroke="#121317" stroke-width="2" />
        {/if}
      {/each}
    </svg>

    {#if dirty && commits.length}
      <button class="row wip-row" style="top:0px; left:{layout.width}px" onclick={onwip} title="Review uncommitted changes">
        <span class="refs"><span class="pill wip">working</span></span>
        <span class="summary">Uncommitted changes</span>
        <span class="meta"><span class="time">now</span></span>
      </button>
    {/if}
    {#each visRows as r (r.c.id)}
      <button
        class="row"
        class:selected={selected === r.c.id}
        style="top:{(r.i + layout.off) * ROW}px; left:{layout.width}px"
        onclick={() => onselect(r.c.id)}
      >
        <span class="refs">
          {#each r.c.refs as ref}
            <span class="pill {refClass(ref)}">{ref}</span>
          {/each}
        </span>
        <span class="summary">{r.c.summary}</span>
        <span class="meta">
          <span class="author">{r.c.author}</span>
          <span class="time">{rel(r.c.time)}</span>
          <span class="hash">{r.c.short}</span>
          <Copy text={r.c.id} title="Copy SHA" />
        </span>
      </button>
    {/each}
  </div>
</div>
