export function buildWaterfallTree(spans) {
    const byId = new Map();
    for (const s of spans) {
        byId.set(s.span_id, { ...s, children: [], depth: 0 });
    }
    const roots = [];
    for (const node of byId.values()) {
        const parentId = node.parent_span_id;
        const parent = parentId ? byId.get(parentId) : undefined;
        if (parent && parent.span_id !== node.span_id) {
            parent.children.push(node);
        }
        else {
            roots.push(node);
        }
    }
    // Assign depth + sort children by start time. Iterative DFS avoids deep
    // recursion blowups and naturally ignores cycles via a visited set.
    const visited = new Set();
    const assign = (node, depth) => {
        if (visited.has(node.span_id))
            return;
        visited.add(node.span_id);
        node.depth = depth;
        node.children.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
        for (const child of node.children)
            assign(child, depth + 1);
    };
    roots.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());
    for (const root of roots)
        assign(root, 0);
    return roots;
}
/** Apdex = (satisfied + tolerating/2) / total. Returns null when no samples. */
export function computeApdex(satisfied, tolerating, total) {
    if (total <= 0)
        return null;
    return Number(((satisfied + tolerating / 2) / total).toFixed(4));
}
//# sourceMappingURL=waterfall.js.map