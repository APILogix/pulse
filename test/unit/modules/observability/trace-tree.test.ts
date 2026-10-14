import { describe, it, expect } from "vitest";

export interface TraceSpan {
  id: string;
  spanId: string;
  parentSpanId?: string | null;
  name: string;
  occurredAt?: string;
  startTime?: string | null;
  endTime?: string | null;
  durationMs?: number;
  traceId: string;
  spanKind?: string;
  spanStatus?: string;
  service?: string | null;
  httpStatusCode?: number | null;
}

export interface SpanTreeNode {
  span: TraceSpan;
  id: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  kind: string;
  status: string;
  service: string | null;
  durationMs: number;
  selfDurationMs: number;
  startOffsetMs: number;
  offsetPercent: number;
  widthPercent: number;
  depth: number;
  isRoot: boolean;
  isBottleneck: boolean;
  hasError: boolean;
  isMissingParent?: boolean;
  children: SpanTreeNode[];
}

function deduplicateSpans(spans: TraceSpan[]): TraceSpan[] {
  const spanMap = new Map<string, TraceSpan>();
  for (const span of spans) {
    const key = span.spanId || span.id;
    if (!key) continue;
    if (!spanMap.has(key)) {
      spanMap.set(key, span);
    } else {
      const existing = spanMap.get(key)!;
      const existingScore = (existing.durationMs ? 1 : 0) + (existing.service ? 1 : 0);
      const newScore = (span.durationMs ? 1 : 0) + (span.service ? 1 : 0);
      if (newScore > existingScore) {
        spanMap.set(key, { ...existing, ...span });
      }
    }
  }
  return Array.from(spanMap.values());
}

function buildSpanTree(
  rawSpans: TraceSpan[],
  totalTraceDurationMs: number,
  rootOccurredAt?: string,
): { tree: SpanTreeNode[]; flatList: SpanTreeNode[]; bottleneckNode: SpanTreeNode | null; hasMissingParents: boolean } {
  const spans = deduplicateSpans(rawSpans);

  if (spans.length === 0) {
    return { tree: [], flatList: [], bottleneckNode: null, hasMissingParents: false };
  }

  const parseSpanTime = (s: TraceSpan): number => {
    const raw = s.startTime || s.occurredAt;
    if (!raw) return NaN;
    const t = new Date(raw).getTime();
    return isNaN(t) ? NaN : t;
  };

  const validStartTimes = spans.map(parseSpanTime).filter((t) => !isNaN(t));
  if (rootOccurredAt) {
    const rootTime = new Date(rootOccurredAt).getTime();
    if (!isNaN(rootTime)) validStartTimes.push(rootTime);
  }

  const globalStartTime = validStartTimes.length > 0 ? Math.min(...validStartTimes) : 0;

  const maxEndTime = spans.reduce((max, s) => {
    const start = parseSpanTime(s);
    const validStart = !isNaN(start) ? start : globalStartTime;
    const dur = Math.max(0, s.durationMs ?? 0);
    return Math.max(max, validStart + dur);
  }, globalStartTime + (totalTraceDurationMs || 0));

  const effectiveTraceDuration = Math.max(
    totalTraceDurationMs > 0 ? totalTraceDurationMs : 0,
    maxEndTime - globalStartTime,
    ...spans.map((s) => s.durationMs ?? 0),
    1,
  );

  const nodeMap = new Map<string, SpanTreeNode>();
  let hasMissingParents = false;

  for (const span of spans) {
    const spanDuration = Math.max(0, span.durationMs ?? 0);
    const parsedStart = parseSpanTime(span);
    const spanStartTime = !isNaN(parsedStart) ? parsedStart : globalStartTime;
    const startOffsetMs = Math.max(0, spanStartTime - globalStartTime);

    const offsetPercent = Math.min(99.5, Math.max(0, (startOffsetMs / effectiveTraceDuration) * 100));
    const rawWidthPercent = (spanDuration / effectiveTraceDuration) * 100;
    const widthPercent = Math.min(100 - offsetPercent, Math.max(0.6, rawWidthPercent));

    const status = (span.spanStatus || "ok").toLowerCase();
    const hasError =
      status === "error" ||
      status === "critical" ||
      status === "fatal" ||
      (span.httpStatusCode != null && span.httpStatusCode >= 500);

    const node: SpanTreeNode = {
      span,
      id: span.id || span.spanId,
      spanId: span.spanId || span.id,
      parentSpanId: span.parentSpanId || null,
      name: span.name || "unnamed-span",
      kind: (span.spanKind || "internal").toLowerCase(),
      status: span.spanStatus || "ok",
      service: span.service || null,
      durationMs: spanDuration,
      selfDurationMs: spanDuration,
      startOffsetMs,
      offsetPercent,
      widthPercent,
      depth: 0,
      isRoot: false,
      isBottleneck: false,
      hasError,
      isMissingParent: false,
      children: [],
    };

    nodeMap.set(node.spanId, node);
  }

  const rootNodes: SpanTreeNode[] = [];

  const createsCycle = (parent: SpanTreeNode, childId: string): boolean => {
    let curr: SpanTreeNode | undefined = parent;
    const visited = new Set<string>();
    while (curr) {
      if (curr.spanId === childId) return true;
      if (visited.has(curr.spanId)) return true;
      visited.add(curr.spanId);
      curr = curr.parentSpanId ? nodeMap.get(curr.parentSpanId) : undefined;
    }
    return false;
  };

  for (const node of nodeMap.values()) {
    if (node.parentSpanId && nodeMap.has(node.parentSpanId) && node.parentSpanId !== node.spanId) {
      const parent = nodeMap.get(node.parentSpanId)!;
      if (!createsCycle(parent, node.spanId)) {
        parent.children.push(node);
      } else {
        node.isRoot = true;
        rootNodes.push(node);
      }
    } else if (node.parentSpanId && !nodeMap.has(node.parentSpanId)) {
      node.isMissingParent = true;
      hasMissingParents = true;
      node.isRoot = true;
      rootNodes.push(node);
    } else {
      node.isRoot = true;
      rootNodes.push(node);
    }
  }

  if (rootNodes.length === 0 && nodeMap.size > 0) {
    const sorted = Array.from(nodeMap.values()).sort((a, b) => b.durationMs - a.durationMs);
    sorted[0].isRoot = true;
    rootNodes.push(sorted[0]);
  }

  rootNodes.sort((a, b) => a.startOffsetMs - b.startOffsetMs || b.durationMs - a.durationMs);

  const flatList: SpanTreeNode[] = [];
  let maxDuration = -1;
  let bottleneckNode: SpanTreeNode | null = null;
  const traversedIds = new Set<string>();

  function traverse(node: SpanTreeNode, currentDepth: number) {
    if (traversedIds.has(node.spanId)) return;
    traversedIds.add(node.spanId);

    node.depth = currentDepth;
    const childrenDuration = node.children.reduce((sum, child) => sum + child.durationMs, 0);
    node.selfDurationMs = Math.max(0, node.durationMs - childrenDuration);

    if (node.durationMs > maxDuration) {
      maxDuration = node.durationMs;
      bottleneckNode = node;
    }

    flatList.push(node);

    node.children.sort((a, b) => a.startOffsetMs - b.startOffsetMs || b.durationMs - a.durationMs);
    for (const child of node.children) {
      traverse(child, currentDepth + 1);
    }
  }

  for (const root of rootNodes) {
    traverse(root, 0);
  }

  for (const node of nodeMap.values()) {
    if (!traversedIds.has(node.spanId)) {
      traverse(node, 0);
    }
  }

  if (bottleneckNode) {
    (bottleneckNode as SpanTreeNode).isBottleneck = true;
  }

  return { tree: rootNodes, flatList, bottleneckNode, hasMissingParents };
}

describe("Trace Hierarchy Reconstruction (buildSpanTree)", () => {
  it("reconstructs normal parent-child hierarchy regardless of input arrival order", () => {
    const rawSpans: TraceSpan[] = [
      {
        id: "span-3",
        spanId: "span-3",
        parentSpanId: "span-2",
        name: "db.users.find",
        occurredAt: "2026-09-22T12:00:00.050Z",
        durationMs: 40,
        traceId: "trace-1",
        spanKind: "client",
      },
      {
        id: "span-2",
        spanId: "span-2",
        parentSpanId: "span-1",
        name: "authenticate",
        occurredAt: "2026-09-22T12:00:00.020Z",
        durationMs: 80,
        traceId: "trace-1",
        spanKind: "internal",
      },
      {
        id: "span-1",
        spanId: "span-1",
        parentSpanId: null,
        name: "GET /api/orders",
        occurredAt: "2026-09-22T12:00:00.000Z",
        durationMs: 200,
        traceId: "trace-1",
        spanKind: "server",
      },
    ];

    const { tree, flatList } = buildSpanTree(rawSpans, 200);

    expect(tree).toHaveLength(1);
    const root = tree[0];
    expect(root.spanId).toBe("span-1");
    expect(root.depth).toBe(0);
    expect(root.children).toHaveLength(1);

    const child = root.children[0];
    expect(child.spanId).toBe("span-2");
    expect(child.depth).toBe(1);
    expect(child.children).toHaveLength(1);

    const grandchild = child.children[0];
    expect(grandchild.spanId).toBe("span-3");
    expect(grandchild.depth).toBe(2);

    expect(flatList.map((n) => n.spanId)).toEqual(["span-1", "span-2", "span-3"]);
  });

  it("handles missing parents and orphan spans gracefully without dropping telemetry", () => {
    const rawSpans: TraceSpan[] = [
      {
        id: "root-1",
        spanId: "root-1",
        parentSpanId: null,
        name: "POST /api/checkout",
        occurredAt: "2026-09-22T12:00:00.000Z",
        durationMs: 150,
        traceId: "trace-2",
      },
      {
        id: "orphan-span",
        spanId: "orphan-span",
        parentSpanId: "missing-parent-999",
        name: "async.event.publish",
        occurredAt: "2026-09-22T12:00:00.030Z",
        durationMs: 60,
        traceId: "trace-2",
      },
    ];

    const { tree, flatList, hasMissingParents } = buildSpanTree(rawSpans, 150);

    expect(hasMissingParents).toBe(true);
    expect(tree).toHaveLength(2);
    expect(flatList).toHaveLength(2);

    const orphanNode = flatList.find((n) => n.spanId === "orphan-span");
    expect(orphanNode).toBeDefined();
    expect(orphanNode?.isMissingParent).toBe(true);
  });

  it("prevents infinite loops on circular parent references", () => {
    const rawSpans: TraceSpan[] = [
      {
        id: "span-a",
        spanId: "span-a",
        parentSpanId: "span-b",
        name: "operation-a",
        occurredAt: "2026-09-22T12:00:00.000Z",
        durationMs: 50,
        traceId: "trace-cycle",
      },
      {
        id: "span-b",
        spanId: "span-b",
        parentSpanId: "span-a",
        name: "operation-b",
        occurredAt: "2026-09-22T12:00:00.010Z",
        durationMs: 40,
        traceId: "trace-cycle",
      },
    ];

    expect(() => buildSpanTree(rawSpans, 100)).not.toThrow();
    const { flatList } = buildSpanTree(rawSpans, 100);
    expect(flatList).toHaveLength(2);
  });

  it("handles zero-duration spans with non-zero minimum rendering width", () => {
    const rawSpans: TraceSpan[] = [
      {
        id: "root-zero",
        spanId: "root-zero",
        parentSpanId: null,
        name: "instant.check",
        occurredAt: "2026-09-22T12:00:00.000Z",
        durationMs: 0,
        traceId: "trace-zero",
      },
    ];

    const { tree } = buildSpanTree(rawSpans, 0);
    expect(tree).toHaveLength(1);
    expect(tree[0].durationMs).toBe(0);
    expect(tree[0].widthPercent).toBeGreaterThan(0);
  });

  it("identifies bottleneck node and calculates exclusive self-duration", () => {
    const rawSpans: TraceSpan[] = [
      {
        id: "root",
        spanId: "root",
        parentSpanId: null,
        name: "handler",
        occurredAt: "2026-09-22T12:00:00.000Z",
        durationMs: 500,
        traceId: "trace-bn",
      },
      {
        id: "fast-child",
        spanId: "fast-child",
        parentSpanId: "root",
        name: "cache.get",
        occurredAt: "2026-09-22T12:00:00.010Z",
        durationMs: 15,
        traceId: "trace-bn",
      },
      {
        id: "slow-child",
        spanId: "slow-child",
        parentSpanId: "root",
        name: "db.heavy.query",
        occurredAt: "2026-09-22T12:00:00.030Z",
        durationMs: 400,
        traceId: "trace-bn",
      },
    ];

    const { bottleneckNode, flatList } = buildSpanTree(rawSpans, 500);

    const rootNode = flatList.find((n) => n.spanId === "root");
    expect(rootNode?.selfDurationMs).toBe(85); // 500 - (15 + 400)

    const slowNode = flatList.find((n) => n.spanId === "slow-child");
    expect(slowNode?.selfDurationMs).toBe(400);

    expect(bottleneckNode?.spanId).toBe("root");
  });
});
