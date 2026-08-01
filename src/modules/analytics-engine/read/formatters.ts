/**
 * Response formatting for the /analytics/v2 read API.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md §2
 *
 * Everything the UI would otherwise compute lives here: display strings, deltas,
 * trend direction, colour semantics (`direction`), zero-filled series and the
 * `aiContext` string that "Ask AI" forwards. The frontend renders only.
 */

import { deltaPct as computeDeltaPct, enumerateBuckets, suggestedRefreshMs } from '../windows.js';
import {
  type AnalyticsQueryScope,
  type AnalyticsResponseMeta,
  type DataTable,
  type DataTableColumn,
  type FreshnessMeta,
  type MetricCard,
  type MetricDirection,
  type MetricSeries,
  type MetricTrend,
  type MetricUnit,
  type RankedList,
  type RankedListItem,
  type WindowSize,
} from '../types.js';

// ── Value formatting ───────────────────────────────────────────────────────

export function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value * 100) / 100);
}

export function formatLatency(ms: number): string {
  if (ms >= 60_000) return `${(ms / 60_000).toFixed(1)}m`;
  if (ms >= 1_000) return `${(ms / 1_000).toFixed(2)}s`;
  if (ms >= 10) return `${Math.round(ms)}ms`;
  return `${ms.toFixed(1)}ms`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let value = Math.abs(bytes);
  let unitIndex = 0;
  while (value >= 1_024 && unitIndex < units.length - 1) {
    value /= 1_024;
    unitIndex += 1;
  }
  const sign = bytes < 0 ? '-' : '';
  return `${sign}${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatValue(value: number | null, unit: MetricUnit): string {
  if (value === null || Number.isNaN(value)) return '—';
  switch (unit) {
    case 'ms':
      return formatLatency(value);
    case 'percent':
      return `${value.toFixed(2)}%`;
    case 'bytes':
      return formatBytes(value);
    case 'micros':
      return `$${(value / 1_000_000).toFixed(2)}`;
    case 'score':
      return String(Math.round(value));
    case 'ratio':
      return value.toFixed(2);
    case 'count':
    default:
      return formatCompact(value);
  }
}

// ── Cards ──────────────────────────────────────────────────────────────────

export interface CardInput {
  key: string;
  label: string;
  value: number | null;
  unit: MetricUnit;
  direction: MetricDirection;
  previous?: number | null;
  sparkline?: number[] | null;
  /** Extra context appended to the generated aiContext sentence. */
  context?: string;
}

/**
 * Trend is purely directional (did the number go up or down); `direction` tells
 * the UI whether that is good. Keeping the two separate is what fixes the current
 * frontend inconsistency where `trend="up"` sometimes means "improving" and
 * sometimes means "increasing".
 */
export function trendFor(value: number | null, previous: number | null | undefined): MetricTrend {
  if (value === null || previous === null || previous === undefined) return 'flat';
  if (value > previous) return 'up';
  if (value < previous) return 'down';
  return 'flat';
}

export function buildCard(input: CardInput, scope: AnalyticsQueryScope): MetricCard {
  const previous = input.previous ?? null;
  const delta = input.value !== null && previous !== null ? input.value - previous : null;
  const deltaPct = computeDeltaPct(input.value, previous);

  const rangeLabel = `${scope.range.from.toISOString()} → ${scope.range.to.toISOString()}`;
  const scopeLabel = scope.projectId ? `project ${scope.projectId}` : `organization ${scope.organizationId}`;
  const changeLabel =
    deltaPct === null
      ? 'no comparable previous window'
      : `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs the previous window`;

  return {
    key: input.key,
    label: input.label,
    value: input.value,
    formatted: formatValue(input.value, input.unit),
    unit: input.unit,
    delta,
    deltaPct,
    trend: trendFor(input.value, previous),
    direction: input.direction,
    sparkline: input.sparkline ?? null,
    aiContext:
      `${input.label} for ${scopeLabel} (environment ${scope.environment}) is ` +
      `${formatValue(input.value, input.unit)} over ${rangeLabel} at ${scope.window} resolution, ` +
      `${changeLabel}.${input.context ? ` ${input.context}` : ''}`,
  };
}

// ── Series ─────────────────────────────────────────────────────────────────

export interface SeriesRow {
  bucket: Date | string;
  value: number | null;
}

/**
 * Zero-fills a series across every bucket in the range so the client never has
 * to reason about gaps. Missing buckets become `0` for counters and `null` for
 * gauges/percentiles (a gap is not "zero latency").
 */
export function buildSeries(
  key: string,
  label: string,
  unit: MetricUnit,
  window: WindowSize,
  rows: readonly SeriesRow[],
  range: { from: Date; to: Date },
  fill: 'zero' | 'null' = 'zero',
): MetricSeries {
  const byBucket = new Map<number, number | null>();
  for (const row of rows) {
    const bucket = row.bucket instanceof Date ? row.bucket : new Date(row.bucket);
    byBucket.set(bucket.getTime(), row.value);
  }

  const points = enumerateBuckets(range.from, range.to, window).map((bucket) => {
    const value = byBucket.get(bucket.getTime());
    return {
      t: bucket.toISOString(),
      v: value === undefined ? (fill === 'zero' ? 0 : null) : value,
    };
  });

  return { key, label, unit, window, points };
}

/** Sparkline values extracted from a series, for embedding in a card. */
export function sparklineFrom(series: MetricSeries, maxPoints = 24): number[] {
  const values = series.points.map((point) => point.v ?? 0);
  if (values.length <= maxPoints) return values;
  const step = values.length / maxPoints;
  return Array.from({ length: maxPoints }, (_, index) => values[Math.floor(index * step)] ?? 0);
}

// ── Ranked lists and tables ────────────────────────────────────────────────

export interface RankedInput {
  key: string;
  label: string;
  unit: MetricUnit;
  items: Array<{
    key: string;
    label: string;
    value: number;
    secondary?: string;
    severity?: RankedListItem['severity'];
    href?: string;
  }>;
  total?: number;
}

export function buildRankedList(input: RankedInput): RankedList {
  return {
    key: input.key,
    label: input.label,
    total: input.total ?? input.items.length,
    items: input.items.map((item) => ({
      key: item.key,
      label: item.label,
      value: item.value,
      formatted: formatValue(item.value, input.unit),
      ...(item.secondary !== undefined ? { secondary: item.secondary } : {}),
      ...(item.severity !== undefined ? { severity: item.severity } : {}),
      ...(item.href !== undefined ? { href: item.href } : {}),
    })),
  };
}

export function buildTable(
  key: string,
  columns: readonly DataTableColumn[],
  rows: ReadonlyArray<Record<string, unknown>>,
  sort: { column: string; direction: 'asc' | 'desc' },
  total?: number,
): DataTable {
  return {
    key,
    columns: [...columns],
    rows: [...rows],
    total: total ?? rows.length,
    sort,
  };
}

/** RFC 4180 CSV rendering of a DataTable, used by `format=csv`. */
export function tableToCsv(table: DataTable): string {
  const escape = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = value instanceof Date ? value.toISOString() : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const header = table.columns.map((column) => escape(column.label)).join(',');
  const body = table.rows
    .map((row) => table.columns.map((column) => escape(row[column.key])).join(','))
    .join('\n');
  return `${header}\n${body}\n`;
}

// ── Response envelope ──────────────────────────────────────────────────────

export function buildFreshness(
  watermark: Date | null,
  staleSeconds: number,
  now = new Date(),
): FreshnessMeta {
  if (!watermark) return { watermark: null, lagSeconds: null, stale: true };
  const lagSeconds = Math.max(0, Math.round((now.getTime() - watermark.getTime()) / 1_000));
  return {
    watermark: watermark.toISOString(),
    lagSeconds,
    stale: lagSeconds > staleSeconds,
  };
}

export function buildMeta(params: {
  scope: AnalyticsQueryScope;
  freshness: FreshnessMeta;
  queryTimeMs: number;
  cacheHit: boolean;
  pagination?: { hasMore: boolean; nextCursor: string | null };
}): AnalyticsResponseMeta {
  const { scope } = params;
  return {
    scope: scope.projectId ? 'project' : 'org',
    organizationId: scope.organizationId,
    projectId: scope.projectId,
    environment: scope.environment,
    window: scope.window,
    range: { from: scope.range.from.toISOString(), to: scope.range.to.toISOString() },
    compareRange: scope.compareRange
      ? {
          from: scope.compareRange.from.toISOString(),
          to: scope.compareRange.to.toISOString(),
        }
      : null,
    generatedAt: new Date().toISOString(),
    freshness: params.freshness,
    queryTimeMs: params.queryTimeMs,
    cache: params.cacheHit ? { hit: true, layer: 'lru' } : { hit: false },
    refresh: { suggestedIntervalMs: suggestedRefreshMs(scope.window) },
    ...(params.pagination ? { pagination: params.pagination } : {}),
  };
}

/** Numeric coercion for Postgres bigint/numeric columns returned as strings. */
export function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Nullable numeric coercion: preserves "no data" instead of turning it into 0. */
export function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function ratePct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return (numerator / denominator) * 100;
}
