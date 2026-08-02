/**
 * Response formatting for the /analytics/v2 read API.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md §2
 *
 * Everything the UI would otherwise compute lives here: display strings, deltas,
 * trend direction, colour semantics (`direction`), zero-filled series and the
 * `aiContext` string that "Ask AI" forwards. The frontend renders only.
 */
import { type AnalyticsQueryScope, type AnalyticsResponseMeta, type DataTable, type DataTableColumn, type FreshnessMeta, type MetricCard, type MetricDirection, type MetricSeries, type MetricTrend, type MetricUnit, type RankedList, type RankedListItem, type WindowSize } from '../types.js';
export declare function formatCompact(value: number): string;
export declare function formatLatency(ms: number): string;
export declare function formatBytes(bytes: number): string;
export declare function formatValue(value: number | null, unit: MetricUnit): string;
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
export declare function trendFor(value: number | null, previous: number | null | undefined): MetricTrend;
export declare function buildCard(input: CardInput, scope: AnalyticsQueryScope): MetricCard;
export interface SeriesRow {
    bucket: Date | string;
    value: number | null;
}
/**
 * Zero-fills a series across every bucket in the range so the client never has
 * to reason about gaps. Missing buckets become `0` for counters and `null` for
 * gauges/percentiles (a gap is not "zero latency").
 */
export declare function buildSeries(key: string, label: string, unit: MetricUnit, window: WindowSize, rows: readonly SeriesRow[], range: {
    from: Date;
    to: Date;
}, fill?: 'zero' | 'null'): MetricSeries;
/** Sparkline values extracted from a series, for embedding in a card. */
export declare function sparklineFrom(series: MetricSeries, maxPoints?: number): number[];
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
export declare function buildRankedList(input: RankedInput): RankedList;
export declare function buildTable(key: string, columns: readonly DataTableColumn[], rows: ReadonlyArray<Record<string, unknown>>, sort: {
    column: string;
    direction: 'asc' | 'desc';
}, total?: number): DataTable;
/** RFC 4180 CSV rendering of a DataTable, used by `format=csv`. */
export declare function tableToCsv(table: DataTable): string;
export declare function buildFreshness(watermark: Date | null, staleSeconds: number, now?: Date): FreshnessMeta;
export declare function buildMeta(params: {
    scope: AnalyticsQueryScope;
    freshness: FreshnessMeta;
    queryTimeMs: number;
    cacheHit: boolean;
    pagination?: {
        hasMore: boolean;
        nextCursor: string | null;
    };
}): AnalyticsResponseMeta;
/** Numeric coercion for Postgres bigint/numeric columns returned as strings. */
export declare function num(value: unknown): number;
/** Nullable numeric coercion: preserves "no data" instead of turning it into 0. */
export declare function numOrNull(value: unknown): number | null;
export declare function ratePct(numerator: number, denominator: number): number | null;
//# sourceMappingURL=formatters.d.ts.map