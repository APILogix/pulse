import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { type PerTypeWriteStats } from '../pipeline/telemetry-writer.js';
import { WriteAdmissionController } from '../pipeline/write-admission.js';
import { type IngestJobPayload } from '../queue/ingest-queues.js';
import type { WorkerMetrics } from './metrics-server.js';
/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export declare function stableStringify(value: unknown): string;
export declare class EventProcessor {
    private readonly pool;
    private readonly metrics;
    private readonly log;
    private readonly writer;
    private readonly usage;
    private readonly errorIngestionService;
    /**
     * Bounds concurrent ingest transactions to the telemetry pool's real capacity.
     *
     * Without this, every pg-boss job handler races on `pool.connect()`. With the
     * per-type worker fan-out (10 queues x localConcurrency x batchSize) demand
     * exceeded the pool by more than an order of magnitude, so handlers spent
     * their time in `pg`'s waiter list and the ones that exceeded
     * `connectionTimeoutMillis` failed with a connection error — turning overload
     * into retries and dead letters instead of just slower progress.
     */
    private readonly admission;
    constructor(pool: Pool, metrics: WorkerMetrics, log: Logger, usagePool?: Pool, admission?: WriteAdmissionController);
    start(): void;
    stop(): Promise<void>;
    /** Process one ingest job payload. Throws to fail the job (pg-boss retry). */
    process(payload: IngestJobPayload, queue: string): Promise<EventProcessorResult>;
}
export interface EventProcessorResult {
    received: number;
    validated: number;
    rejected: number;
    inserted: number;
    duplicates: number;
    outboxInserted: number;
    perType: Record<string, PerTypeWriteStats>;
    dbQueries: number;
    dbQueryMs: number;
    queueWaitMs: number | null;
    timings: Record<string, number>;
}
//# sourceMappingURL=event-processor.d.ts.map