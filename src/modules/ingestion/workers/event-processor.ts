/**
 * EventProcessor — the shared per-type ingestion pipeline.
 *
 * One instance per worker process, constructed by the WorkerRegistry and
 * reused by every per-type pg-boss worker. For each IngestJobPayload:
 *
 *   1. VALIDATE every raw event through normalizeEvent() (the security
 *      boundary). Rejects are routed to the DLQ intake queue as a
 *      DlqIntakePayload (reason: validation) and counted.
 *   2. IDENTITY: events without an eventId get a deterministic one —
 *      sha256(projectId + ':' + type + ':' + stableStringify(event)) sliced to
 *      32 hex chars — so SDK/batch retries and pg-boss redeliveries carry the
 *      same identity and are dropped by the (project_id, event_id) unique
 *      indexes. normalizeEvent produces `eventId` (optional, all types) and
 *      the TelemetryWriter reads exactly that field, so we write it there.
 *   3. PERSIST via TelemetryWriter.writeBatchDetailed() — idempotent inserts
 *      that report how many rows were ACTUALLY written.
 *   4. ERROR GROUPING (errors only, and only for rows confirmed inserted):
 *      upsert analytics_error_groups keyed (organization_id, project_id,
 *      fingerprint) — count/last_seen bump on repeat, resolved→unresolved
 *      regression flip.
 *   5. USAGE: increments against the process-wide 3-tier UsageCounter with
 *      driveRollup: false — the usage-rollup cron job owns flushing into the
 *      billing tables; this counter only drains memory into staging.
 *   6. METRICS: per-type processing latency and e2e latency
 *      (now − metadata.receivedAt).
 */
import { createHash } from 'crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import { pgboss } from '../../../lib/pgboss.js';
import {
  normalizeEvent,
  normalizeSdkEnvironment,
  type NormalizedEvent,
} from '../pipeline/event-normalizer.js';
import {
  TelemetryWriter,
/**
 * EventProcessor — the shared per-type ingestion pipeline.
 *
 * One instance per worker process, constructed by the WorkerRegistry and
 * reused by every per-type pg-boss worker. For each IngestJobPayload:
 *
 *   1. VALIDATE every raw event through normalizeEvent() (the security
 *      boundary). Rejects are routed to the DLQ intake queue as a
 *      DlqIntakePayload (reason: validation) and counted.
 *   2. IDENTITY: events without an eventId get a deterministic one —
 *      sha256(projectId + ':' + type + ':' + stableStringify(event)) sliced to
 *      32 hex chars — so SDK/batch retries and pg-boss redeliveries carry the
 *      same identity and are dropped by the (project_id, event_id) unique
 *      indexes. normalizeEvent produces `eventId` (optional, all types) and
 *      the TelemetryWriter reads exactly that field, so we write it there.
 *   3. PERSIST via TelemetryWriter.writeBatchDetailed() — idempotent inserts
 *      that report how many rows were ACTUALLY written.
 *   4. ERROR GROUPING (errors only, and only for rows confirmed inserted):
 *      upsert analytics_error_groups keyed (organization_id, project_id,
 *      fingerprint) — count/last_seen bump on repeat, resolved→unresolved
 *      regression flip.
 *   5. USAGE: increments against the process-wide 3-tier UsageCounter with
 *      driveRollup: false — the usage-rollup cron job owns flushing into the
 *      billing tables; this counter only drains memory into staging.
 *   6. METRICS: per-type processing latency and e2e latency
 *      (now − metadata.receivedAt).
 */
import { createHash } from 'crypto';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import { env } from '../../../config/env.js';
import { pgboss } from '../../../lib/pgboss.js';
import {
  normalizeEvent,
  normalizeSdkEnvironment,
  type NormalizedEvent,
} from '../pipeline/event-normalizer.js';
import {
  TelemetryWriter,
  errorFingerprint,
  errorNameOf,
  type ScopedEvent,
} from '../pipeline/telemetry-writer.js';
import { UsageCounter } from '../usage/usage-counter.js';
import {
  INGEST_DLQ_INTAKE_QUEUE,
  type DlqIntakePayload,
  type IngestJobPayload,
} from '../queue/ingest-queues.js';
import type { WorkerMetrics } from './metrics-server.js';
import { ErrorIngestionService } from '../../errors/services/error-ingestion.service.js';
import { ErrorGroupingService } from '../../errors/services/error-grouping.service.js';
import { ErrorGroupRepository } from '../../errors/repositories/error-group.repository.js';
import { ErrorRepository } from '../../errors/repositories/error.repository.js';

/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const parts: string[] = [];
    for (const key of Object.keys(o).sort()) {
      if (o[key] === undefined) continue;
      parts.push(`${JSON.stringify(key)}:${stableStringify(o[key])}`);
    }
    return `{${parts.join(',')}}`;
  }
  return 'null';
}

/** Deterministic storage identity for events that arrive without one. */
function deterministicEventId(
  projectId: string,
  environment: string,
  type: string,
  event: NormalizedEvent,
): string {
  return createHash('sha256')
    .update(`${projectId}:${environment}:${type}:${stableStringify(event)}`)
    .digest('hex')
    .slice(0, 32);
}

function str(v: unknown, max = 255): string | null {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}

export class EventProcessor {
  private readonly writer: TelemetryWriter;
  private readonly usage: UsageCounter;
  private readonly errorIngestionService: ErrorIngestionService;

  constructor(
    private readonly pool: Pool,
    private readonly metrics: WorkerMetrics,
    private readonly log: Logger,
    usagePool: Pool = pool,
  ) {
    this.writer = new TelemetryWriter(pool);
    // The usage-rollup cron job is the ONLY rollup driver (driveRollup: false)
    // — this instance just drains tier-1 memory into usage_counter_staging.
    this.usage = new UsageCounter(usagePool, log, {
      flushIntervalMs: env.INGESTION_USAGE_FLUSH_MS,
      bufferLimit: env.INGESTION_USAGE_BUFFER_LIMIT,
      driveRollup: false,
    });
    
    const errorGroupRepo = new ErrorGroupRepository(pool);
    const errorRepo = new ErrorRepository(pool);
    const errorGroupingService = new ErrorGroupingService(errorGroupRepo);
    this.errorIngestionService = new ErrorIngestionService(pool, errorGroupingService, errorRepo);
  }

  start(): void {
    this.usage.start();
  }

  async stop(): Promise<void> {
    await this.usage.stop();
  }

  /** Process one ingest job payload. Throws to fail the job (pg-boss retry). */
  async process(payload: IngestJobPayload, queue: string): Promise<void> {
    const startedAt = Date.now();
    const type = payload?.eventType;
    const projectId = payload?.projectId ?? '';
    const orgId = payload?.organizationId ?? '';
    const rawEvents = Array.isArray(payload?.events) ? payload.events : [];
    const environment = normalizeSdkEnvironment(payload?.metadata?.environment);
    if (!environment) throw new Error('INVALID_ENVIRONMENT');
    this.log.info(
      {
        queue,
        eventType: type ?? 'unknown',
        batchId: payload?.metadata?.batchId,
        received: rawEvents.length,
      },
      'ingestion event type picked',
    );
    console.log('--- INCOMING PAYLOAD ---');
    console.log(JSON.stringify(rawEvents, null, 2));
    console.log('------------------------');

    // 1) Validate + 2) assign deterministic identity.
    const scoped: ScopedEvent[] = [];
    const rejected: Array<{ event: unknown; detail: string }> = [];
    for (const raw of rawEvents) {
      const r = normalizeEvent(raw);
      if (!r.ok) {
        rejected.push({ event: raw, detail: `${r.reason}: ${r.detail}` });
        continue;
      }
      const event = r.event;
      const eventId = (event as { eventId?: unknown }).eventId;
      if (typeof eventId !== 'string' || eventId.length === 0) {
        (event as { eventId?: string }).eventId = deterministicEventId(
          projectId,
          environment,
          type,
          event,
        );
      }
      scoped.push({ projectId, orgId, environment, event });
    }

    // Route validation rejects to the DLQ intake queue (one message per job).
    // If this send throws, the job fails and retries — rejects are never lost.
    if (rejected.length > 0) {
      const dlq: DlqIntakePayload = {
        sourceQueue: queue,
        organizationId: orgId,
        projectId,
        environment,
        eventType: type ?? 'unknown',
        payload: rejected,
        failedAt: new Date().toISOString(),
        error: `validation_failed: ${rejected.length} event(s) rejected; first: ${rejected[0]?.detail ?? 'unknown'}`,
      };
      await pgboss.send(INGEST_DLQ_INTAKE_QUEUE, dlq, {} as never);
    }

    // 3) Process events based on type.
    let result = { totalInserted: 0, totalReceived: rawEvents.length, insertedErrors: [] as any[] };
    
    if (type === 'error') {
      const errorBatch = scoped.map(s => {
        const e = s.event as any;
        const errorName = errorNameOf(s.event);
        const fingerprint = errorFingerprint(s.event, errorName);
        return {
          groupParams: {
            projectId: s.projectId,
            fingerprint,
            eventId: e.eventId,
            severity: e.level || e.severity || 'error',
            release: typeof e.release === 'string' ? e.release : undefined,
            sdkVersion: typeof e.sdk?.version === 'string' ? e.sdk.version : undefined,
            applicationVersion: undefined,
          },
          eventRecord: {
            id: typeof e.id === 'string' ? e.id : require('crypto').randomUUID(),
            organization_id: s.orgId,
            project_id: s.projectId,
            event_id: e.eventId,
            fingerprint,
            message: e.message || errorName,
            error_name: errorName,
            severity: e.level || e.severity || 'error',
            timestamp: new Date(e.timestamp),
            payload: e
          }
        };
      });
      
      try {
        await this.errorIngestionService.ingestBatch(errorBatch);
        result.totalInserted = errorBatch.length;
      } catch (err) {
        this.log.error({ err, queue, batchId: payload?.metadata?.batchId }, 'error ingestion batch failed');
        throw err;
      }
    } else {
      result = await this.writer.writeBatchDetailedWithOutbox(scoped);
    }

    this.log.info(
      {
        queue,
        eventType: type ?? 'unknown',
        batchId: payload?.metadata?.batchId,
        received: rawEvents.length,
        rejected: rejected.length,
        inserted: result.totalInserted,
      },
      'ingestion event type stored',
    );

    // 5) Usage accounting (inserted rows only — duplicates are never billed).
    if (result.totalInserted > 0 && orgId && projectId) {
      this.usage.increment(projectId, orgId, `billing:events:${type}`, result.totalInserted);
      this.usage.increment(projectId, orgId, 'events', result.totalInserted, {
        apiKeyId: payload.metadata.apiKeyId || null,
        eventType: type ?? 'all',
      });
    }

    // 6) Metrics.
    const receivedAt = Date.parse(payload?.metadata?.receivedAt ?? '');
    const e2eMs = Number.isFinite(receivedAt) ? Math.max(0, Date.now() - receivedAt) : null;
    this.metrics.recordProcessed(
      queue,
      type ?? 'unknown',
      rawEvents.length,
      result.totalInserted,
      rejected.length,
      Date.now() - startedAt,
      e2eMs,
    );
    if (rejected.length > 0 || result.totalInserted !== result.totalReceived) {
      this.log.debug(
        {
          queue, type, received: rawEvents.length, inserted: result.totalInserted,
          rejected: rejected.length, duplicates: result.totalReceived - result.totalInserted,
        },
        'ingest job processed with drops',
      );
    }
  }
}
