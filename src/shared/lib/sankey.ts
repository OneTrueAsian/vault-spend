/** Pure layout math for the Reports page's income → spending Sankey
 * diagram — no charting library, same hand-rolled-inline-SVG approach as
 * `charts.tsx`. Kept separate from any component so the node/link
 * bookkeeping and the flow-geometry math can be unit tested without
 * rendering anything.
 *
 * `buildSankeyData` turns a flat "income + spending-by-category" summary
 * into a small typed graph; `layoutSankey` turns that graph into pixel
 * boxes and slices; `sankeyRibbonPath` turns one slice-to-slice link into
 * an SVG path string. The caller (`ReportsView`) only ever touches these
 * three functions plus the types below. */

export type SankeyFlow = { label: string; amount: number };

export type SankeyNode = {
  id: string;
  label: string;
  value: number;
  /** Which vertical column the node sits in — 0 is furthest left. Not
   * assumed to be 0/1 only: a shortfall (spending exceeding income) adds a
   * third, middle "Total spending" column so no category link has to
   * arbitrarily decide how much of itself came from income versus the
   * shortfall. */
  column: number;
};

export type SankeyLink = { source: string; target: string; value: number };

export type SankeyData = {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totalIncome: number;
  totalSpending: number;
  /** income − totalSpending. Positive is money left over; negative is a
   * shortfall (spending exceeded income). */
  leftover: number;
};

/** Builds the Sankey graph for one report range: income on the left,
 * flowing to the biggest `maxCategories` spending categories plus an
 * "Other" bucket for the rest, plus either a "Left over" flow (income
 * exceeded spending) or a "Shortfall" flow feeding in from the left
 * alongside Income (spending exceeded income). `categories` should already
 * exclude transfers — this function only lays out whatever it's given.
 *
 * Reserved node ids ("income", "shortfall", "spending", "other",
 * "leftover") are namespaced away from category ids (`cat:${label}`) so a
 * real category literally named "Other" or "Left over" can't collide with
 * the synthetic nodes. */
export function buildSankeyData(income: number, categories: SankeyFlow[], maxCategories = 8): SankeyData {
  const positive = categories.filter((c) => c.amount > 0);
  const sorted = [...positive].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  const top = sorted.slice(0, maxCategories);
  const rest = sorted.slice(maxCategories);
  const otherAmount = rest.reduce((s, c) => s + c.amount, 0);
  const totalSpending = sorted.reduce((s, c) => s + c.amount, 0);
  const leftover = income - totalSpending;

  if (income <= 0 && totalSpending <= 0) {
    return { nodes: [], links: [], totalIncome: Math.max(income, 0), totalSpending: 0, leftover: 0 };
  }

  const nodes: SankeyNode[] = [];
  const links: SankeyLink[] = [];
  const categoryNode = (c: SankeyFlow) => ({ id: `cat:${c.label}`, label: c.label, value: c.amount, column: leftover < 0 ? 2 : 1 });

  if (leftover >= 0) {
    // Two columns: Income on the left flows directly into each category,
    // "Other" and any "Left over" on the right.
    nodes.push({ id: "income", label: "Income", value: income, column: 0 });
    for (const c of top) {
      const node = categoryNode(c);
      nodes.push(node);
      links.push({ source: "income", target: node.id, value: c.amount });
    }
    if (otherAmount > 0) {
      nodes.push({ id: "other", label: "Other", value: otherAmount, column: 1 });
      links.push({ source: "income", target: "other", value: otherAmount });
    }
    if (leftover > 0) {
      nodes.push({ id: "leftover", label: "Left over", value: leftover, column: 1 });
      links.push({ source: "income", target: "leftover", value: leftover });
    }
  } else {
    // Three columns: Income and Shortfall both feed a "Total spending"
    // node (spending exceeded income, so no single category link can
    // honestly say how much of itself was funded by income versus the
    // shortfall), which then fans out to the categories.
    const shortfall = totalSpending - income;
    if (income > 0) {
      nodes.push({ id: "income", label: "Income", value: income, column: 0 });
      links.push({ source: "income", target: "spending", value: income });
    }
    nodes.push({ id: "shortfall", label: "Shortfall", value: shortfall, column: 0 });
    links.push({ source: "shortfall", target: "spending", value: shortfall });
    nodes.push({ id: "spending", label: "Total spending", value: totalSpending, column: 1 });
    for (const c of top) {
      const node = categoryNode(c);
      nodes.push(node);
      links.push({ source: "spending", target: node.id, value: c.amount });
    }
    if (otherAmount > 0) {
      nodes.push({ id: "other", label: "Other", value: otherAmount, column: 2 });
      links.push({ source: "spending", target: "other", value: otherAmount });
    }
  }

  return { nodes, links, totalIncome: income, totalSpending, leftover };
}

export type PositionedNode = SankeyNode & { x: number; y0: number; y1: number };
export type PositionedLink = SankeyLink & { sy0: number; sy1: number; ty0: number; ty1: number };
export type SankeyLayout = { nodes: PositionedNode[]; links: PositionedLink[]; width: number; height: number; nodeWidth: number };

/** Places `data`'s nodes into columns spanning `width`, each column's
 * nodes stacked top to bottom scaled to fill `height` (minus padding
 * between them), and slices each link's endpoints out of its source and
 * target nodes' own scale — the standard Sankey layout technique (as in
 * d3-sankey), reimplemented minimally here since node/link counts are
 * always small (at most ~11) and the columns are already known and
 * non-cyclic, so no iterative relaxation pass is needed. */
export function layoutSankey(data: SankeyData, width: number, height: number, nodeWidth = 16, nodePadding = 10): SankeyLayout {
  if (data.nodes.length === 0) return { nodes: [], links: [], width, height, nodeWidth };

  const columns = [...new Set(data.nodes.map((n) => n.column))].sort((a, b) => a - b);
  const xForColumn = new Map(columns.map((c, i) => [c, columns.length > 1 ? (i * (width - nodeWidth)) / (columns.length - 1) : 0]));

  const positioned = new Map<string, PositionedNode>();
  for (const col of columns) {
    const colNodes = data.nodes.filter((n) => n.column === col);
    const totalValue = colNodes.reduce((s, n) => s + n.value, 0);
    const available = Math.max(height - nodePadding * Math.max(colNodes.length - 1, 0), 0);
    const scale = totalValue > 0 ? available / totalValue : 0;
    let cursor = 0;
    for (const n of colNodes) {
      const h = n.value * scale;
      positioned.set(n.id, { ...n, x: xForColumn.get(col) ?? 0, y0: cursor, y1: cursor + h });
      cursor += h + nodePadding;
    }
  }

  const outCursor = new Map<string, number>();
  const inCursor = new Map<string, number>();
  const links: PositionedLink[] = data.links.map((l) => {
    const source = positioned.get(l.source)!;
    const target = positioned.get(l.target)!;
    const sourceScale = source.value > 0 ? (source.y1 - source.y0) / source.value : 0;
    const targetScale = target.value > 0 ? (target.y1 - target.y0) / target.value : 0;
    const sy0 = source.y0 + (outCursor.get(l.source) ?? 0);
    const sh = l.value * sourceScale;
    outCursor.set(l.source, (outCursor.get(l.source) ?? 0) + sh);
    const ty0 = target.y0 + (inCursor.get(l.target) ?? 0);
    const th = l.value * targetScale;
    inCursor.set(l.target, (inCursor.get(l.target) ?? 0) + th);
    return { ...l, sy0, sy1: sy0 + sh, ty0, ty1: ty0 + th };
  });

  return { nodes: [...positioned.values()], links, width, height, nodeWidth };
}

/** Keeps a column of node labels from printing on top of each other. Takes
 * the vertical centre each label would like (top to bottom) and returns
 * positions at least `minGap` apart, all inside `[min, max]`, moved as
 * little as possible: a crowded run is pushed down, and if that runs off the
 * bottom the run is pulled back up. If they can't all fit at `minGap`, they're
 * spread evenly over the range instead. */
export function spreadLabelPositions(desired: number[], minGap: number, min: number, max: number): number[] {
  const n = desired.length;
  if (n === 0) return [];
  const out = desired.map((y, i) => (i === 0 ? Math.max(y, min) : y));
  for (let i = 1; i < n; i++) out[i] = Math.max(out[i], out[i - 1] + minGap);
  if (out[n - 1] > max) {
    out[n - 1] = max;
    for (let i = n - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - minGap);
  }
  if (out[0] < min) return n === 1 ? [min] : out.map((_, i) => min + (i * (max - min)) / (n - 1));
  return out;
}

/** A horizontal ribbon between a source slice `[y0Top, y0Bottom]` at `x0`
 * and a target slice `[y1Top, y1Bottom]` at `x1`, as an SVG path — two
 * cubic Béziers meeting in the middle, the same shape d3-sankey draws for
 * its links. Pure string math so it's testable without a DOM. */
export function sankeyRibbonPath(x0: number, y0Top: number, y0Bottom: number, x1: number, y1Top: number, y1Bottom: number): string {
  const xi = (x0 + x1) / 2;
  return (
    `M${x0},${y0Top} C${xi},${y0Top} ${xi},${y1Top} ${x1},${y1Top} ` + `L${x1},${y1Bottom} C${xi},${y1Bottom} ${xi},${y0Bottom} ${x0},${y0Bottom} Z`
  );
}
