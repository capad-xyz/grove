<script>
  // Renders a commit graph: an SVG of lanes/nodes on the left, aligned with a
  // column of commit rows on the right. Lane layout is computed here in one
  // pass over the topologically-ordered commits from the Rust side.
  let { commits = [], selected = null, onselect = () => {} } = $props();

  const ROW = 32; // px per commit row
  const LANE = 18; // px per graph lane
  const PAD = 16; // left padding before lane 0
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
  const y = (i) => ROW / 2 + i * ROW;

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

    const laneCount = maxLane + 1;
    const height = commits.length * ROW;
    const edges = [];
    for (const r of placed) {
      const x1 = x(r.lane);
      const y1 = y(r.i);
      r.commit.parents.forEach((p, pi) => {
        const pl = r.parentLanes[pi];
        const x2 = x(pl);
        const j = rowOf.get(p);
        const color = laneColor(pl);
        if (j === undefined) {
          // Parent outside the loaded window: trail off the bottom.
          edges.push({ d: `M ${x1} ${y1} L ${x2} ${height}`, color });
        } else {
          const y2 = y(j);
          const d =
            x1 === x2
              ? `M ${x1} ${y1} L ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1} ${y1 + ROW * 0.6}, ${x2} ${y2 - ROW * 0.6}, ${x2} ${y2}`;
          edges.push({ d, color });
        }
      });
    }

    const nodes = placed.map((r) => ({
      x: x(r.lane),
      y: y(r.i),
      color: laneColor(r.lane),
      commit: r.commit,
    }));

    const width = PAD + laneCount * LANE + PAD;
    return { nodes, edges, width, height };
  });

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

  const isHead = (r) => r === "HEAD";
</script>

<div class="graph" style="--row:{ROW}px">
  <svg
    class="lanes"
    width={layout.width}
    height={layout.height}
    style="min-width:{layout.width}px"
  >
    {#each layout.edges as e}
      <path d={e.d} stroke={e.color} fill="none" stroke-width="2" />
    {/each}
    {#each layout.nodes as n}
      <circle cx={n.x} cy={n.y} r={R} fill={n.color} stroke="#15171c" stroke-width="2" />
    {/each}
  </svg>

  <div class="rows">
    {#each commits as c}
      <button
        class="row"
        class:selected={selected === c.id}
        onclick={() => onselect(c.id)}
      >
        <span class="refs">
          {#each c.refs as r}
            <span class="pill" class:head={isHead(r)}>{r}</span>
          {/each}
        </span>
        <span class="summary">{c.summary}</span>
        <span class="meta">
          <span class="author">{c.author}</span>
          <span class="time">{rel(c.time)}</span>
          <span class="hash">{c.short}</span>
        </span>
      </button>
    {/each}
  </div>
</div>
