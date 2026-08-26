import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { type PerTypeWriteStats } from '../pipeline/telemetry-writer.js';
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
    constructor(pool: Pool, metrics: WorkerMetrics, log: Logger, usagePool?: Pool);
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