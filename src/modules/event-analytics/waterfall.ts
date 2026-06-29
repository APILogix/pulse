/**
 * Trace waterfall tree builder (pure).
 *
 * Converts a flat list of spans into a parent/child tree for waterfall
 * rendering. Spans whose parent is missing from the set (or null) become
 * roots. Children are ordered by start time. Cycles are guarded against.
 */
export interface FlatSpan {
  span_id: string;
  parent_span_id: string | null;
  start_time: string | Date;
  [key: string]: unknown;
}

export interface WaterfallNode extends FlatSpan {
  children: WaterfallNode[];
  depth: number;
}

export function buildWaterfallTree(spans: FlatSpan[]): WaterfallNode[] {
  const byId = new Map<string, WaterfallNode>();
  for (const s of spans) {
    byId.set(s.span_id, { ...s, children: [], depth: 0 });
  }

  const roots: WaterfallNode[] = [];
  for (const node of byId.values()) {
    const parentId = node.parent_span_id;
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent && parent.span_id !== node.span_id) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Assign depth + sort children by start time. Iterative DFS avoids deep
  // recursion blowups and naturally ignores cycles via a visited set.
  const visited = new Set<string>();
  const assign = (node: WaterfallNode, depth: number): void => {
    if (visited.has(node.span_id)) return;
    visited.add(node.span_id);
    node.depth = depth;
    node.children.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    for (const child of node.children) assign(child, depth + 1);
  };
  roots.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
  for (const root of roots) assign(root, 0);

  return roots;
}

/** Apdex = (satisfied + tolerating/2) / total. Returns null when no samples. */
export function computeApdex(satisfied: number, tolerating: number, total: number): number | null {
  if (total <= 0) return null;
  return Number(((satisfied + tolerating / 2) / total).toFixed(4));
}
