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
import { env } from '../../../config/env.js';
import { pgboss } from '../../../lib/pgboss.js';
import { normalizeEvent, } from '../pipeline/event-normalizer.js';
import { TelemetryWriter, errorFingerprint, errorNameOf, } from '../pipeline/telemetry-writer.js';
import { UsageCounter } from '../usage/usage-counter.js';
import { INGEST_DLQ_INTAKE_QUEUE, } from '../queue/ingest-queues.js';
/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function stableStringify(value) {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        return JSON.stringify(value);
    }
    if (typeof value === 'string')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(stableStringify).join(',')}]`;
    if (typeof value === 'object') {
        const o = value;
        const parts = [];
        for (const key of Object.keys(o).sort()) {
            if (o[key] === undefined)
                continue;
            parts.push(`${JSON.stringify(key)}:${stableStringify(o[key])}`);
        }
        return `{${parts.join(',')}}`;
    }
    return 'null';
}
/** Deterministic storage identity for events that arrive without one. */
function deterministicEventId(projectId, type, event) {
    return createHash('sha256')
        .update(`${projectId}:${type}:${stableStringify(event)}`)
        .digest('hex')
        .slice(0, 32);
}
function str(v, max = 255) {
    return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}
/**
 * Error-group upsert. Insert: first_seen/last_seen = now, counts = the
 * occurrence count, status default ('unresolved'). Conflict: bump occurrence
 * counters + last_seen, refresh name/template, merge service/environment/
 * release tag arrays, and flip 'resolved' back to 'unresolved' (regression
 * detection).
 */
const UPSERT_ERROR_GROUP_SQL = `
  INSERT INTO analytics_error_groups
    (organization_id, project_id, fingerprint, error_name, message_template,
     first_seen_at, last_seen_at, total_count, today_count, week_count, month_count,
     status, services, environments, releases)
  VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $6, $6, $6,
          'unresolved', $7::text[], $8::text[], $9::text[])
  ON CONFLICT (organization_id, project_id, fingerprint) DO UPDATE SET
    last_seen_at = NOW(),
    total_count = analytics_error_groups.total_count + EXCLUDED.total_count,
    today_count = analytics_error_groups.today_count + EXCLUDED.today_count,
    week_count = analytics_error_groups.week_count + EXCLUDED.week_count,
    month_count = analytics_error_groups.month_count + EXCLUDED.month_count,
    status = CASE WHEN analytics_error_groups.status = 'resolved'
                  THEN 'unresolved'::error_group_status
                  ELSE analytics_error_groups.status END,
    error_name = EXCLUDED.error_name,
    message_template = EXCLUDED.message_template,
    services = (SELECT array_agg(DISTINCT v) FROM unnest(
      COALESCE(analytics_error_groups.services, '{}'::text[]) || COALESCE(EXCLUDED.services, '{}'::text[])) AS u(v)),
    environments = (SELECT array_agg(DISTINCT v) FROM unnest(
      COALESCE(analytics_error_groups.environments, '{}'::text[]) || COALESCE(EXCLUDED.environments, '{}'::text[])) AS u(v)),
    releases = (SELECT array_agg(DISTINCT v) FROM unnest(
      COALESCE(analytics_error_groups.releases, '{}'::text[]) || COALESCE(EXCLUDED.releases, '{}'::text[])) AS u(v))`;
export class EventProcessor {
    pool;
    metrics;
    log;
    writer;
    usage;
    constructor(pool, metrics, log) {
        this.pool = pool;
        this.metrics = metrics;
        this.log = log;
        this.writer = new TelemetryWriter(pool);
        // The usage-rollup cron job is the ONLY rollup driver (driveRollup: false)
        // — this instance just drains tier-1 memory into usage_counter_staging.
        this.usage = new UsageCounter(pool, log, {
            flushIntervalMs: env.INGESTION_USAGE_FLUSH_MS,
            bufferLimit: env.INGESTION_USAGE_BUFFER_LIMIT,
            driveRollup: false,
        });
    }
    start() {
        this.usage.start();
    }
    async stop() {
        await this.usage.stop();
    }
    /** Process one ingest job payload. Throws to fail the job (pg-boss retry). */
    async process(payload, queue) {
        const startedAt = Date.now();
        const type = payload?.eventType;
        const projectId = payload?.projectId ?? '';
        const orgId = payload?.organizationId ?? '';
        const rawEvents = Array.isArray(payload?.events) ? payload.events : [];
        // 1) Validate + 2) assign deterministic identity.
        const scoped = [];
        const rejected = [];
        for (const raw of rawEvents) {
            const r = normalizeEvent(raw);
            if (!r.ok) {
                rejected.push({ event: raw, detail: `${r.reason}: ${r.detail}` });
                continue;
            }
            const event = r.event;
            const eventId = event.eventId;
            if (typeof eventId !== 'string' || eventId.length === 0) {
                event.eventId = deterministicEventId(projectId, type, event);
            }
            scoped.push({ projectId, orgId, event });
        }
        // Route validation rejects to the DLQ intake queue (one message per job).
        // If this send throws, the job fails and retries — rejects are never lost.
        if (rejected.length > 0) {
            const dlq = {
                sourceQueue: queue,
                organizationId: orgId,
                projectId,
                eventType: type ?? 'unknown',
                payload: rejected,
                failedAt: new Date().toISOString(),
                error: `validation_failed: ${rejected.length} event(s) rejected; first: ${rejected[0]?.detail ?? 'unknown'}`,
            };
            await pgboss.send(INGEST_DLQ_INTAKE_QUEUE, dlq, {});
        }
        // 3) Idempotent persistence — learn what was ACTUALLY inserted.
        const result = await this.writer.writeBatchDetailed(scoped);
        // 4) Error grouping for confirmed-inserted errors only.
        if (result.insertedErrors.length > 0) {
            await this.upsertErrorGroups(result.insertedErrors);
        }
        // 5) Usage accounting (inserted rows only — duplicates are never billed).
        if (result.totalInserted > 0 && orgId && projectId) {
            this.usage.increment(projectId, orgId, `billing:events:${type}`, result.totalInserted);
            this.usage.increment(projectId, orgId, 'events_persisted', result.totalInserted);
        }
        // 6) Metrics.
        const receivedAt = Date.parse(payload?.metadata?.receivedAt ?? '');
        const e2eMs = Number.isFinite(receivedAt) ? Math.max(0, Date.now() - receivedAt) : null;
        this.metrics.recordProcessed(queue, type ?? 'unknown', rawEvents.length, result.totalInserted, rejected.length, Date.now() - startedAt, e2eMs);
        if (rejected.length > 0 || result.totalInserted !== result.totalReceived) {
            this.log.debug({
                queue, type, received: rawEvents.length, inserted: result.totalInserted,
                rejected: rejected.length, duplicates: result.totalReceived - result.totalInserted,
            }, 'ingest job processed with drops');
        }
    }
    /**
     * Upsert analytics_error_groups for inserted error events. Aggregated per
     * (org, project, fingerprint) so a batch of N identical errors costs one
     * statement. Retried jobs contribute nothing here because their rows were
     * already inserted by the first attempt (writeBatchDetailed returns them as
     * duplicates, excluded from insertedErrors).
     */
    async upsertErrorGroups(insertedErrors) {
        const groups = new Map();
        for (const { orgId, projectId, event } of insertedErrors) {
            if (!orgId)
                continue;
            const e = event;
            const r = event;
            const errorName = errorNameOf(event);
            const fingerprint = errorFingerprint(event, errorName);
            const key = `${orgId}|${projectId}|${fingerprint}`;
            let acc = groups.get(key);
            if (!acc) {
                acc = {
                    orgId,
                    projectId,
                    fingerprint,
                    errorName,
                    messageTemplate: e.message.slice(0, 500),
                    service: str(r.service, 100),
                    environment: str(r.environment, 50),
                    release: str(r.release, 100),
                    count: 0,
                };
                groups.set(key, acc);
            }
            acc.count += 1;
        }
        for (const g of groups.values()) {
            await this.pool.query(UPSERT_ERROR_GROUP_SQL, [
                g.orgId,
                g.projectId,
                g.fingerprint,
                g.errorName,
                g.messageTemplate,
                g.count,
                g.service ? [g.service] : [],
                g.environment ? [g.environment] : [],
                g.release ? [g.release] : [],
            ]);
        }
    }
}
//# sourceMappingURL=event-processor.js.map