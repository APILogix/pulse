/**
 * Ingestion buffer.
 *
 * Flow:
 * 1. Events are accepted into memory immediately to keep SDK ingestion latency
 *    low.
 * 2. The buffer flushes either when it reaches maxSize or when the short timer
 *    expires.
 * 3. Flushes create BullMQ jobs in bulk with event ids as job ids, giving the
 *    queue another idempotency layer.
 * 4. If BullMQ rejects a flush, events are pushed back into memory and bounded
 *    backpressure prevents unbounded process growth.
 */
import { Queue } from 'bullmq';
import type { EnrichedEvent } from './types.js';
export interface BufferMetrics {
    pending: number;
    flushedTotal: number;
    lastFlushAt: number | null;
}
/**
 * In-memory buffer with backpressure handling.
 * Accumulates events before bulk-pushing to BullMQ.
 */
export declare class IngestionBuffer {
    private queue;
    private buffer;
    private flushTimer;
    private isFlushing;
    private flushedTotal;
    private lastFlushAt;
    private readonly maxSize;
    private readonly flushIntervalMs;
    private readonly maxRetries;
    constructor(queue: Queue, options?: {
        maxSize?: number;
        flushIntervalMs?: number;
        maxRetries?: number;
    });
    add(event: EnrichedEvent): Promise<void>;
    flush(): Promise<void>;
    private pushToQueue;
    destroy(): Promise<void>;
    get metrics(): BufferMetrics;
}
//# sourceMappingURL=buffer.d.ts.map