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

export const WINDOW_TIERS_SECONDS = [5, 15, 30, 60, 300, 900, 3600] as const;

export function isSupportedWindow(seconds: number): boolean {
  return WINDOW_TIERS_SECONDS.includes(seconds as (typeof WINDOW_TIERS_SECONDS)[number]);
}

export function evaluateMetric(request: MetricRequest, context: MetricContext, now = new Date()): MetricResult {
  const windowSeconds = request.windowSeconds ?? 60;
  const cutoff = now.getTime() - windowSeconds * 1000;
  const values = (context.series[request.numerator ?? 'value'] ?? [])
    .filter((sample) => sample.occurredAt.getTime() >= cutoff)
    .map((sample) => sample.value)
    .filter(Number.isFinite);
  if (request.aggregation === 'count') return { value: values.length, sampleCount: values.length, windowSeconds };
  if (values.length === 0) return { value: null, sampleCount: 0, windowSeconds };
  if (request.aggregation === 'ratio' || request.aggregation === 'percentage') {
    const denominator = (context.series[request.denominator ?? 'denominator'] ?? [])
      .filter((sample) => sample.occurredAt.getTime() >= cutoff)
      .reduce((sum, sample) => sum + sample.value, 0);
    return { value: denominator === 0 ? null : request.aggregation === 'percentage' ? (sum(values) / denominator) * 100 : sum(values) / denominator, sampleCount: values.length, windowSeconds };
  }
  if (request.aggregation === 'rate') return { value: sum(values) / windowSeconds, sampleCount: values.length, windowSeconds };
  if (request.aggregation === 'moving_average') return { value: sum(values) / values.length, sampleCount: values.length, windowSeconds };
  if (request.aggregation === 'threshold') return { value: values[values.length - 1] ?? null, sampleCount: values.length, windowSeconds };
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = request.aggregation === 'p50' ? 0.5 : request.aggregation === 'p95' ? 0.95 : 0.99;
  return { value: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * percentile) - 1)] ?? null, sampleCount: values.length, windowSeconds };
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
