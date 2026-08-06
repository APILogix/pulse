export type MetricAggregation = 'threshold' | 'rate' | 'percentage' | 'moving_average' | 'count' | 'ratio' | 'p50' | 'p95' | 'p99';
export interface MetricSample {
    value: number;
    occurredAt: Date;
}
export interface MetricRequest {
    aggregation: MetricAggregation;
    numerator?: string;
    denominator?: string;
    windowSeconds?: number;
}
export interface MetricContext {
    series: Record<string, MetricSample[]>;
}
export interface MetricResult {
    value: number | null;
    sampleCount: number;
    windowSeconds: number;
}
export declare const WINDOW_TIERS_SECONDS: readonly [5, 15, 30, 60, 300, 900, 3600];
export declare function isSupportedWindow(seconds: number): boolean;
export declare function evaluateMetric(request: MetricRequest, context: MetricContext, now?: Date): MetricResult;
//# sourceMappingURL=metric-registry.d.ts.map