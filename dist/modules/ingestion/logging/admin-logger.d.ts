/**
 * AdminLogger — buffered, dual-sink structured logger for the ingestion worker
 * tier's administrative/operational events.
 *
 * Two sinks, written together on flush:
 *   1. ingestion_admin_logs   (PRIMARY Postgres, partitioned)  — for IMMEDIATE
 *      operator queries from the dashboard / API.
 *   2. admin_audit_log        (TimescaleDB hypertable)         — for long-term
 *      historical analytics + retention policy. Skipped when LogDatabase is
 *      disabled (TIMESCALEDB_URL unset).
 *
 * Buffering: entries accumulate in memory and flush every `flushIntervalMs`
 * (default 5s) or when the buffer reaches `bufferSize` (default 100). This
 * keeps high-frequency operational logging off the synchronous hot path while
 * bounding loss to a single flush window on crash.
 *
 * Never throws on the logging path — a logging failure must not break
 * ingestion. Failed flushes re-buffer (bounded) and retry on the next cycle.
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import type { LogDatabase } from './log-database.js';
export type AdminLogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export interface AdminLogContext {
    orgId?: string | null;
    projectId?: string | null;
    jobId?: string | null;
    eventId?: string | null;
    workerId?: string | null;
    metadata?: Record<string, unknown> | null;
}
export interface AdminLoggerOptions {
    bufferSize?: number;
    flushIntervalMs?: number;
}
export declare class AdminLogger {
    private readonly pool;
    private readonly logDb;
    private readonly log;
    private buffer;
    private readonly bufferSize;
    private readonly flushIntervalMs;
    private timer;
    private flushing;
    private stopped;
    private static readonly MAX_BUFFER;
    constructor(pool: Pool, logDb: LogDatabase, log: Logger, opts?: AdminLoggerOptions);
    start(): void;
    debug(category: string, message: string, ctx?: AdminLogContext): void;
    info(category: string, message: string, ctx?: AdminLogContext): void;
    warn(category: string, message: string, ctx?: AdminLogContext): void;
    error(category: string, message: string, ctx?: AdminLogContext): void;
    fatal(category: string, message: string, ctx?: AdminLogContext): void;
    private enqueue;
    /** Drain the buffer to both sinks. Re-entrancy guarded; never throws. */
    flush(): Promise<void>;
    private writePrimary;
    /** Final flush + stop the timer. */
    stop(): Promise<void>;
}
//# sourceMappingURL=admin-logger.d.ts.map