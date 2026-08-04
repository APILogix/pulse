/**
 * Analytics engine shared types.
 *
 * Contracts implemented here:
 *   docs/analytics/00-architecture-overview.md  (processing model, windows)
 *   docs/analytics/06-worker-architecture.md    (worker registry contract)
 *   docs/analytics/07-rollup-tables.md          (rollup shapes, sentinels)
 *   docs/analytics/08-dashboard-api-contracts.md (API primitives)
 */
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
export declare const WINDOW_SIZES: readonly ["1m", "5m", "1h", "1d"];
export type WindowSize = (typeof WINDOW_SIZES)[number];
export declare const WINDOW_SECONDS: Record<WindowSize, number>;
/** Postgres `date_trunc` unit + multiple used to align a bucket. */
export declare const WINDOW_TRUNC: Record<WindowSize, {
    unit: string;
    multiple: number;
}>;
/** Retention per tier (docs/analytics/00-architecture-overview.md §5). */
export declare const WINDOW_RETENTION_SECONDS: Record<WindowSize, number>;
/** Suggested client refetch interval per tier. */
export declare const WINDOW_REFRESH_MS: Record<WindowSize, number>;
/** Compaction chain: each window is built from the finer one. */
export declare const WINDOW_SOURCE: Record<Exclude<WindowSize, '1m'>, WindowSize>;
/** Rollup rows that aggregate every project of an organization. */
export declare const ALL_PROJECTS_SENTINEL = "00000000-0000-0000-0000-000000000000";
/** Rollup rows that aggregate every environment. Cannot be produced by ingestion. */
export declare const ALL_ENVIRONMENTS_SENTINEL = "__all__";
/** Overflow bucket for Shape B rollups beyond ANALYTICS_ENTITY_TOPK. */
export declare const OTHER_ENTITY_SENTINEL = "__other__";
export declare const TELEMETRY_SIGNALS: readonly ["requests", "errors", "logs", "metrics", "spans", "traces", "messages", "profiles", "replays", "cron_checkins"];
export type TelemetrySignal = (typeof TELEMETRY_SIGNALS)[number];
/** Canonical Log DB table for each signal. */
export declare const SIGNAL_TABLE: Record<TelemetrySignal, string>;
export declare const ANALYTICS_WORKER_IDS: readonly ["analytics.requests", "analytics.endpoints", "analytics.services", "analytics.errors", "analytics.logs", "analytics.metrics", "analytics.runtime", "analytics.spans", "analytics.traces", "analytics.crons", "analytics.profiles", "analytics.replays", "analytics.sessions", "analytics.geo", "analytics.sdk", "analytics.releases", "analytics.slo", "analytics.security", "analytics.usage", "analytics.alerts", "analytics.ai", "analytics.anomalies", "analytics.health", "analytics.compaction", "analytics.retention", "analytics.partitions", "analytics.dispatch"];
export type AnalyticsWorkerId = (typeof ANALYTICS_WORKER_IDS)[number];
/** Dispatch cadence tiers (docs/analytics/06-worker-architecture.md §4). */
export type WorkerTier = 'live' | 'standard' | 'slow' | 'platform';
export declare const TIER_INTERVAL_MS: Record<WorkerTier, number>;
export interface AnalyticsJobData {
    orgId: string;
    /** Inclusive lower bound on events_*.ingested_at. */
    windowStart: string;
    /** Exclusive upper bound on events_*.ingested_at. */
    windowEnd: string;
    /** Set when a dispatcher forces a full recompute of a bucket range. */
    recomputeFrom?: string;
}
export type WorkerOutcome = 'success' | 'partial' | 'failed' | 'skipped';
export interface WorkerRunResult {
    outcome: WorkerOutcome;
    rowsRead: number;
    rowsWritten: number;
    /** Highest ingested_at consumed; the watermark advances to this value. */
    watermarkAt: Date;
    /** Newest event-time bucket materialised, for freshness reporting. */
    lastBucketAt?: Date | undefined;
    errorMessage?: string | undefined;
}
export interface WorkerContext {
    pool: Pool;
    logger: Logger;
    now: Date;
    config: AnalyticsEngineConfig;
}
export interface AnalyticsEngineConfig {
    batchMaxRows: number;
    maxWindowSpanMinutes: number;
    lateEventGraceSeconds: number;
    statementTimeoutMs: number;
    entityTopK: number;
    apdexThresholdMs: number;
    sessionIdleMinutes: number;
    freshnessStaleSeconds: number;
    retentionEnabled: boolean;
}
export interface AnalyticsWorkerSpec {
    id: AnalyticsWorkerId;
    /** pg-boss queue name; identical to `id` so queue ownership is obvious. */
    queue: string;
    tier: WorkerTier;
    /** Primary output granularity. Coarser tiers come from analytics.compaction. */
    windowSize: WindowSize;
    /** Read-only inputs. Asserted by test/unit/analytics-engine-workers.test.ts. */
    sourceTables: readonly string[];
    /** Exclusive write set. No table may appear in two specs. */
    outputTables: readonly string[];
    concurrency: number;
    retryLimit: number;
    retryBackoffSeconds: number;
    lateGraceSeconds: number;
    maxSpanMinutes: number;
    description: string;
    run(ctx: WorkerContext, job: AnalyticsJobData): Promise<WorkerRunResult>;
}
export interface WatermarkRow {
    workerId: string;
    organizationId: string;
    windowSize: WindowSize;
    watermarkAt: Date;
    lastBucketAt: Date | null;
    lastRunAt: Date;
    rowsProcessed: number;
    consecutiveFailures: number;
    lastError: string | null;
}
export interface WorkerHealthSnapshot {
    id: string;
    lagSeconds: number;
    consecutiveFailures: number;
    lastRunAt: string | null;
    rowsProcessedLastRun: number;
    status: 'healthy' | 'degraded' | 'unhealthy' | 'idle';
}
export type RollupShape = 'A' | 'B';
/** Key columns per shape (docs/analytics/07-rollup-tables.md §1). */
export declare const SHAPE_A_KEYS: readonly ["organization_id", "project_id", "environment", "bucket"];
export declare const SHAPE_B_KEYS: readonly ["organization_id", "project_id", "environment", "bucket", "entity_key"];
export interface RollupUpsert {
    table: string;
    shape: RollupShape;
    /** Column list in the same order as every row tuple. Must include the keys. */
    columns: readonly string[];
    rows: readonly unknown[][];
}
export type MetricUnit = 'count' | 'ms' | 'percent' | 'bytes' | 'micros' | 'score' | 'ratio';
export type MetricDirection = 'higher_is_better' | 'lower_is_better' | 'neutral';
export type MetricTrend = 'up' | 'down' | 'flat';
export interface MetricCard {
    key: string;
    label: string;
    value: number | null;
    formatted: string;
    unit: MetricUnit;
    delta: number | null;
    deltaPct: number | null;
    trend: MetricTrend;
    direction: MetricDirection;
    sparkline: number[] | null;
    aiContext: string;
}
export interface MetricSeriesPoint {
    t: string;
    v: number | null;
}
export interface MetricSeries {
    key: string;
    label: string;
    unit: MetricUnit;
    window: WindowSize;
    points: MetricSeriesPoint[];
}
export interface RankedListItem {
    key: string;
    label: string;
    value: number;
    formatted: string;
    secondary?: string;
    severity?: 'ok' | 'warn' | 'critical';
    href?: string;
}
export interface RankedList {
    key: string;
    label: string;
    total: number;
    items: RankedListItem[];
}
export interface DataTableColumn {
    key: string;
    label: string;
    align: 'left' | 'right';
    format: string;
    sortable: boolean;
}
export interface DataTable {
    key: string;
    columns: DataTableColumn[];
    rows: Array<Record<string, unknown>>;
    total: number;
    sort: {
        column: string;
        direction: 'asc' | 'desc';
    };
}
export interface AnalyticsRange {
    from: Date;
    to: Date;
}
export interface AnalyticsQueryScope {
    organizationId: string;
    projectId: string | null;
    environment: string;
    range: AnalyticsRange;
    compareRange: AnalyticsRange | null;
    window: WindowSize;
    service?: string | undefined;
    release?: string | undefined;
    limit: number;
    cursor?: string | undefined;
    sort?: {
        column: string;
        direction: 'asc' | 'desc';
    } | undefined;
    q?: string | undefined;
}
export interface FreshnessMeta {
    watermark: string | null;
    lagSeconds: number | null;
    stale: boolean;
}
export interface AnalyticsResponseMeta {
    scope: 'org' | 'project';
    organizationId: string;
    projectId: string | null;
    environment: string;
    window: WindowSize;
    range: {
        from: string;
        to: string;
    };
    compareRange: {
        from: string;
        to: string;
    } | null;
    generatedAt: string;
    freshness: FreshnessMeta;
    queryTimeMs: number;
    cache: {
        hit: boolean;
        layer?: 'lru';
    };
    refresh: {
        suggestedIntervalMs: number;
    };
    pagination?: {
        hasMore: boolean;
        nextCursor: string | null;
    };
}
export interface AnalyticsResponse<T> {
    meta: AnalyticsResponseMeta;
    data: T;
}
export type QueryRunner = Pick<Pool | PoolClient, 'query'>;
export declare function isWindowSize(value: unknown): value is WindowSize;
//# sourceMappingURL=types.d.ts.map