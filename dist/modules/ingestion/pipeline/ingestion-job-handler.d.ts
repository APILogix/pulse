/**
 * Ingestion job handler.
 *
 * Bridges the PgQueue worker to telemetry persistence. Each queue job carries a
 * tenant-scoped, already-normalized event envelope (produced at enqueue time):
 *
 *   { projectId, orgId, event: NormalizedEvent }
 *
 * The handler re-validates defensively (queue payloads are JSONB round-tripped
 * and could be tampered if the DB were compromised), then writes via
 * TelemetryWriter. Throwing propagates to the worker, which applies retry/DLQ.
 */
import type { ClaimedJob } from '../queue/pg-queue.js';
import type { TelemetryWriter } from './telemetry-writer.js';
export declare function createIngestionJobHandler(writer: TelemetryWriter): (job: ClaimedJob) => Promise<void>;
//# sourceMappingURL=ingestion-job-handler.d.ts.map