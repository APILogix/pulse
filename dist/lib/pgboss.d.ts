import EventEmitter from 'node:events';
import { type Pool, type PoolConfig } from 'pg';
import { PgBoss } from 'pg-boss';
/**
 * Resilient Database Adapter for PgBoss.
 * Built specifically for serverless Postgres providers (such as Neon) where:
 * 1. Computes scale to zero / suspend when idle and take 1-4s to wake up (cold start).
 * 2. Idle TCP connections are terminated server-side by PgBouncer / Neon compute proxy.
 * 3. Background maintenance and queue polling ticks require automatic transparent query retry.
 */
export declare class ResilientPgBossDb extends EventEmitter {
    pool: Pool | null;
    config: PoolConfig & {
        schema?: string;
        keepAliveInitialDelayMillis?: number;
    };
    _pgbdb: boolean;
    opened: boolean;
    constructor(config: PoolConfig & {
        schema?: string;
        keepAliveInitialDelayMillis?: number;
    });
    events: {
        error: string;
    };
    open(): Promise<void>;
    close(): Promise<void>;
    /**
     * Executes SQL with exponential backoff retry on transient connection breaks
     * (e.g. Neon waking from cold start or replacing a dropped idle socket).
     */
    executeSql(text: string, values?: unknown[]): Promise<{
        rows: any[];
    }>;
    /**
     * Runs queries within a single pinned client transaction.
     */
    withTransaction<T>(fn: (txDb: {
        executeSql: (text: string, values?: unknown[]) => Promise<{
            rows: any[];
        }>;
    }) => Promise<T>): Promise<T>;
    /**
     * Dedicated session connection for LISTEN/NOTIFY with automatic reconnection.
     */
    listen(channel: string, onNotification: (payload: string) => void, onReconnect: () => void): Promise<{
        close(): Promise<void>;
    }>;
}
/**
 * Enterprise PgBoss Singleton.
 * Configured with resilient serverless Postgres adapter to prevent
 * connection timeout and unexpected socket drop issues on Neon.
 */
export declare const pgboss: PgBoss;
/** Starts pg-boss once even when multiple modules request it concurrently. */
export declare function startPgBoss(): Promise<void>;
/** Gracefully shuts down pg-boss without exceeding the process drain budget. */
export declare function stopPgBoss(timeout?: number): Promise<void>;
//# sourceMappingURL=pgboss.d.ts.map