import type { Pool } from 'pg';
import type { Logger } from 'pino';
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
    constructor(pool: Pool, metrics: WorkerMetrics, log: Logger);
    start(): void;
    stop(): Promise<void>;
    /** Process one ingest job payload. Throws to fail the job (pg-boss retry). */
    process(payload: IngestJobPayload, queue: string): Promise<void>;
    /**
     * Upsert analytics_error_groups for inserted error events. Aggregated per
     * (org, project, fingerprint) so a batch of N identical errors costs one
     * statement. Retried jobs contribute nothing here because their rows were
     * already inserted by the first attempt (writeBatchDetailed returns them as
     * duplicates, excluded from insertedErrors).
     */
    private upsertErrorGroups;
}
//# sourceMappingURL=event-processor.d.ts.map