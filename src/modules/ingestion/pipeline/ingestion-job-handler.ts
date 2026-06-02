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
import type { TelemetryWriter, ScopedEvent } from './telemetry-writer.js';
import { normalizeEvent } from './event-normalizer.js';

interface JobEnvelope {
  projectId: string;
  orgId: string | null;
  event: unknown;
}

export function createIngestionJobHandler(writer: TelemetryWriter) {
  return async function handle(job: ClaimedJob): Promise<void> {
    const env = job.payload as JobEnvelope | JobEnvelope[];
    const envelopes = Array.isArray(env) ? env : [env];

    const scoped: ScopedEvent[] = [];
    for (const e of envelopes) {
      if (!e || typeof e !== 'object') continue;
      // Defensive re-validation; queue payloads are untrusted at rest.
      const result = normalizeEvent(e.event);
      if (!result.ok) continue; // poison rows are dropped, not retried forever
      scoped.push({ projectId: e.projectId, orgId: e.orgId ?? null, event: result.event });
    }

    if (scoped.length === 0) {
      throw new Error('NO_PERSISTABLE_EVENTS');
    }

    await writer.writeBatch(scoped);
  };
}
