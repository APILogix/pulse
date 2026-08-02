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
export declare function buildWaterfallTree(spans: FlatSpan[]): WaterfallNode[];
/** Apdex = (satisfied + tolerating/2) / total. Returns null when no samples. */
export declare function computeApdex(satisfied: number, tolerating: number, total: number): number | null;
//# sourceMappingURL=waterfall.d.ts.map