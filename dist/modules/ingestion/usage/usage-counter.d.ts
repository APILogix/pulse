import type { Pool } from 'pg';
import type { Logger } from 'pino';
export type CounterType = 'events' | 'requests' | 'errors' | 'bytes_ingested' | 'rate_limited' | string;
export interface UsageDimensions {
    apiKeyId?: string | null;
    eventType?: string | null;
}
export interface UsageCounterOptions {
    flushIntervalMs?: number;
    bufferLimit?: number;
    driveRollup?: boolean;
}
export declare class UsageCounter {
    private readonly pool;
    private readonly log;
    private buffer;
    private readonly flushIntervalMs;
    private readonly bufferLimit;
    private readonly driveRollup;
    private timer;
    private flushPromise;
    private flushRequested;
    private stopped;
    private schemaReady;
    constructor(pool: Pool, log: Logger, opts?: UsageCounterOptions);
    start(): void;
    increment(projectId: string, orgId: string, counterType: CounterType, by?: number, dimensions?: UsageDimensions): void;
    flush(): Promise<void>;
    private flushOnce;
    private ensureSchema;
    private runRollup;
    getUsage(projectId: string, counterType: CounterType, periodStart?: Date): Promise<number>;
    stop(): Promise<void>;
}
//# sourceMappingURL=usage-counter.d.ts.map