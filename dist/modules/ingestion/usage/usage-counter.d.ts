/**
 * UsageCounter — ultra-low-latency, three-tier usage accounting.
 *
 * The ingestion hot path must NEVER block on a usage write. Counting every
 * accepted/persisted event with a synchronous DB UPDATE would serialize the
 * pipeline on a single hot row per project. Instead we use three tiers:
 *
 *   Tier 1  In-memory Map<string, number> per worker process.
 *           increment() only touches memory — O(1), allocation-free on the hot
 *           path, never awaits. This is where the ingestion pipeline calls in.
 *
 *   Tier 2  usage_counter_staging — an UNLOGGED Postgres table (no WAL). On a
 *           timer (or when the buffer is large) we drain the memory map into a
 *           single multi-row INSERT. UNLOGGED keeps these writes cheap; the
 *           trade-off is they are lost on an unclean crash, which is acceptable
 *           for approximate usage pre-aggregation.
 *
 *   Tier 3  project_usage — durable, hourly-bucketed rollups. The SQL function
 *           flush_usage_counters() aggregates settled staging rows into hourly
 *           buckets and UPSERTs them, then deletes the consumed rows.
 *
 * Reads go through the project_usage_realtime view, which sums the durable
 * buckets plus the un-flushed staging tail so a read never misses the last few
 * seconds of activity.
 *
 * Delivery semantics: at-least-once aggregation with bounded loss only on an
 * unclean process crash before the next 30s flush (tier-1 memory). The durable
 * telemetry rows themselves are never affected — this is a side-channel counter.
 *
 * Migration: migrations2/010_add_ingestion_usage_counters.up.sql.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
/** Common counter types. Free-form strings are allowed; these are the canon. */
export type CounterType = 'events_ingested' | 'events_accepted' | 'events_rejected' | 'events_shed' | 'bytes_ingested' | string;
export interface UsageCounterOptions {
    /** Auto-flush cadence in milliseconds. Default 30s. */
    flushIntervalMs?: number;
    /** Force a flush when the in-memory buffer reaches this many keys. Default 10k. */
    bufferLimit?: number;
}
export declare class UsageCounter {
    private readonly pool;
    private readonly log;
    private buffer;
    private readonly flushIntervalMs;
    private readonly bufferLimit;
    private timer;
    private flushing;
    private stopped;
    constructor(pool: Pool, log: Logger, opts?: UsageCounterOptions);
    /** Start the periodic flush timer. Safe to call once. */
    start(): void;
    /**
     * Tier-1 increment. Fire-and-forget: updates memory only, never awaits, never
     * throws. When the buffer crosses the limit we kick off an async flush but do
     * NOT block the caller on it.
     */
    increment(projectId: string, orgId: string, counterType: CounterType, by?: number): void;
    /**
     * Tier-1 -> Tier-2 -> Tier-3 flush. Drains the in-memory map into a single
     * multi-row INSERT against the UNLOGGED staging table, then asks Postgres to
     * roll settled staging rows up into the durable hourly buckets.
     *
     * Re-entrancy guarded: only one flush runs at a time. On insert failure the
     * drained counts are merged back into the buffer so nothing is lost between
     * flush attempts.
     */
    flush(): Promise<void>;
    /** Drive flush_usage_counters() until it stops returning work (bounded). */
    private runRollup;
    /**
     * Read current usage for a project/counter. Uses the realtime view so the
     * un-flushed staging tail is included. When periodStart is omitted, sums all
     * buckets for the counter.
     */
    getUsage(projectId: string, counterType: CounterType, periodStart?: Date): Promise<number>;
    /** Final flush + stop the timer. Call on graceful shutdown. */
    stop(): Promise<void>;
}
//# sourceMappingURL=usage-counter.d.ts.map