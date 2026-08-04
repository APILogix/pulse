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
import type { UsageCounter } from '../usage/usage-counter.js';
import { normalizeEvent, normalizeSdkEnvironment } from './event-normalizer.js';
import { pgboss } from '../../../lib/pgboss.js';

const ALERT_FAST_QUEUE = 'alert.evaluate.fast';

interface JobEnvelope {
  projectId: string;
  orgId: string | null;
  environment?: unknown;
  event: unknown;
}

export function createIngestionJobHandler(writer: TelemetryWriter, usage?: UsageCounter) {
  return async function handle(job: ClaimedJob): Promise<void> {
    const env = job.payload as JobEnvelope | JobEnvelope[];
    const envelopes = Array.isArray(env) ? env : [env];

    const scoped: ScopedEvent[] = [];
    for (const e of envelopes) {
      if (!e || typeof e !== 'object') continue;
      const environment = normalizeSdkEnvironment(e.environment);
      if (!environment) continue;
      // Defensive re-validation; queue payloads are untrusted at rest.
      const result = normalizeEvent(e.event);
      if (!result.ok) continue; // poison rows are dropped, not retried forever
      scoped.push({ projectId: e.projectId, orgId: e.orgId ?? null, environment, event: result.event });
    }

    if (scoped.length === 0) {
      throw new Error('NO_PERSISTABLE_EVENTS');
    }

    const writeResult = await writer.writeBatchDetailed(scoped);
    if (writeResult.totalInserted > 0) {
      await enqueueFastAlertEvaluations(scoped);
    }

    // Fire-and-forget canonical event accounting. Signal type remains an
    // explicit rollup dimension instead of being encoded in a counter name.
    if (usage) {
      for (const scopedEvent of scoped) {
        if (scopedEvent.orgId) {
          usage.increment(scopedEvent.projectId, scopedEvent.orgId, 'events', 1, {
            eventType: scopedEvent.event.type,
          });
        }
      }
    }
  };
}

async function enqueueFastAlertEvaluations(scoped: ScopedEvent[]): Promise<void> {
  const grouped = new Map<string, ScopedEvent[]>();
  for (const event of scoped) {
    if (!event.orgId) continue;
    const key = JSON.stringify([event.orgId, event.projectId, event.environment]);
    const list = grouped.get(key) ?? [];
    list.push(event);
    grouped.set(key, list);
  }

  await Promise.all([...grouped.values()].map((events) => {
    const first = events[0]!;
    return pgboss.send(
      ALERT_FAST_QUEUE,
      {
        organizationId: first.orgId!,
        projectId: first.projectId,
        environment: first.environment,
        events,
      },
      {
        singletonKey: `alert-fast:${first.orgId}:${first.projectId}:${hashEvents(events)}`,
        expireInSeconds: 60,
        retryLimit: 3,
        retryDelay: 1,
        retryBackoff: true,
      } as never,
    );
  }));
}

function hashEvents(events: ScopedEvent[]): string {
  return events
    .map((event) => {
      const record = event.event as { eventId?: unknown; type?: unknown; timestamp?: unknown };
      return `${String(record.type)}:${String(record.eventId ?? '')}:${String(record.timestamp ?? '')}`;
    })
    .join('|')
    .slice(0, 180);
}
