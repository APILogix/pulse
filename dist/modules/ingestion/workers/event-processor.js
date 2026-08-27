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
import { createHash, randomUUID } from 'crypto';
import { env } from '../../../config/env.js';
import { pgboss } from '../../../lib/pgboss.js';
import { normalizeEvent, normalizeSdkEnvironment, resolveTimestamp, } from '../pipeline/event-normalizer.js';
import { TelemetryWriter, applyIngestionTransactionSettings, errorFingerprint, errorNameOf, } from '../pipeline/telemetry-writer.js';
import { WriteAdmissionController, resolveWritePermits } from '../pipeline/write-admission.js';
import { UsageCounter } from '../usage/usage-counter.js';
import { INGEST_DLQ_INTAKE_QUEUE, } from '../queue/ingest-queues.js';
import { ErrorIngestionService } from '../../errors/services/error-ingestion.service.js';
import { ErrorGroupingService } from '../../errors/services/error-grouping.service.js';
import { ErrorGroupRepository } from '../../errors/repositories/error-group.repository.js';
import { ErrorRepository } from '../../errors/repositories/error.repository.js';
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
function deterministicEventId(projectId, environment, type, event) {
    return createHash('sha256')
        .update(`${projectId}:${environment}:${type}:${stableStringify(event)}`)
        .digest('hex')
        .slice(0, 32);
}
function str(v, max = 255) {
    return typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;
}
function elapsedSince(start) {
    return Date.now() - start;
}
function instrumentClientQueries(client, onQueryComplete) {
    const originalQuery = client.query;
    client.query = ((...args) => {
        const queryStartedAt = Date.now();
        const record = () => onQueryComplete(elapsedSince(queryStartedAt));
        const lastArg = args[args.length - 1];
        if (typeof lastArg === 'function') {
            const callback = lastArg;
            args[args.length - 1] = (...callbackArgs) => {
                record();
                return callback(...callbackArgs);
            };
            try {
                return originalQuery.apply(client, args);
            }
            catch (err) {
                record();
                throw err;
            }
        }
        try {
            const result = originalQuery.apply(client, args);
            if (result && typeof result.then === 'function') {
                return result.then((value) => {
                    record();
                    return value;
                }, (err) => {
                    record();
                    throw err;
                });
            }
            record();
            return result;
        }
        catch (err) {
            record();
            throw err;
        }
    });
    return () => {
        client.query = originalQuery;
    };
}
function serializedBytes(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value));
    }
    catch {
        return 0;
    }
}
function errorCode(err) {
    if (!err || typeof err !== 'object')
        return null;
    const value = err.code;
    return typeof value === 'string' && value.length > 0 ? value : null;
}
/**
 * Identity of an event for outbox filtering: `(organization_id, event_id)`.
 *
 * Both sides of the comparison read the SAME raw values — `ScopedEvent.orgId` /
 * `event.eventId` on one side and `eventRecord.organization_id` /
 * `eventRecord.event_id` on the other, where the record fields were populated
 * from exactly those scoped fields. No truncation or normalization is applied
 * here on purpose: introducing any would risk a silent mismatch that drops
 * legitimate outbox rows (a correctness bug in alert delivery).
 *
 * NUL is the separator because it cannot appear in a UUID or an SDK event id,
 * so `(a, bc)` can never collide with `(ab, c)`.
 */
function outboxIdentityKey(orgId, eventId) {
    return `${orgId ?? ''}\u0000${eventId}`;
}
/** Raw SDK event id off a scoped event, matching what the error record stored. */
function scopedEventId(scoped) {
    const value = scoped.event.eventId;
    return typeof value === 'string' ? value : '';
}
function ingestionFailureClass(err) {
    const code = errorCode(err);
    if (code === '55P03')
        return 'db_lock_timeout';
    if (code === '57014')
        return 'db_statement_timeout';
    if (code === '53300' || code === '08000' || code === '08003' || code === '08006')
        return 'db_connection';
    if (code && code.startsWith('23'))
        return 'idempotency';
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    if (message.includes('lock timeout') || message.includes('canceling statement due to lock timeout'))
        return 'db_lock_timeout';
    if (message.includes('statement timeout') || message.includes('canceling statement due to statement timeout'))
        return 'db_statement_timeout';
    if (message.includes('timeout') || message.includes('connection') || message.includes('econn') || message.includes('terminating connection'))
        return 'db_connection';
    if (message.includes('duplicate') || message.includes('conflict'))
        return 'idempotency';
    return 'unknown';
}
export class EventProcessor {
    pool;
    metrics;
    log;
    writer;
    usage;
    errorIngestionService;
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
    admission;
    constructor(pool, metrics, log, usagePool = pool, admission) {
        this.pool = pool;
        this.metrics = metrics;
        this.log = log;
        // Derive permits from the pool actually being written to, so the invariant
        // "permits <= pool capacity" holds regardless of how the pool was built.
        const poolMax = pool.options?.max;
        const permits = resolveWritePermits(env.INGESTION_WRITE_CONCURRENCY, typeof poolMax === 'number' && poolMax > 0 ? poolMax : env.INGESTION_WRITE_POOL_SIZE);
        this.admission = admission ?? new WriteAdmissionController(permits);
        // Optional-called: unit tests inject partial WorkerMetrics stubs, and metrics
        // reporting must never be able to fail worker construction.
        this.metrics.setWritePermits?.(permits);
        log.info({ writePermits: permits, telemetryPoolMax: poolMax ?? null, configured: env.INGESTION_WRITE_CONCURRENCY }, 'ingest write admission configured');
        this.writer = new TelemetryWriter(pool, log);
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
        this.errorIngestionService = new ErrorIngestionService(pool, errorGroupingService, errorRepo, this.metrics, log);
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
        const apiKeyName = payload?.metadata?.apiKeyName;
        const rawEvents = Array.isArray(payload?.events) ? payload.events : [];
        const environment = normalizeSdkEnvironment(payload?.metadata?.environment);
        if (!environment)
            throw new Error('INVALID_ENVIRONMENT');
        const receivedAt = Date.parse(payload?.metadata?.receivedAt ?? '');
        const queueWaitMs = Number.isFinite(receivedAt) ? Math.max(0, startedAt - receivedAt) : null;
        const timings = {};
        const serializationStartedAt = Date.now();
        const batchBytes = serializedBytes(rawEvents);
        timings.serializationMs = elapsedSince(serializationStartedAt);
        this.log.debug({
            queue,
            eventType: type ?? 'unknown',
            batchId: payload?.metadata?.batchId,
            received: rawEvents.length,
        }, 'ingestion event type picked');
        // 1) Validate + 2) assign deterministic identity.
        const validationStartedAt = Date.now();
        let normalizationMs = 0;
        const scoped = [];
        const rejected = [];
        for (const raw of rawEvents) {
            const normalizationStartedAt = Date.now();
            const r = normalizeEvent(raw);
            normalizationMs += elapsedSince(normalizationStartedAt);
            if (!r.ok) {
                rejected.push({ event: raw, detail: `${r.reason}: ${r.detail}` });
                continue;
            }
            const event = r.event;
            const eventId = event.eventId;
            if (typeof eventId !== 'string' || eventId.length === 0) {
                event.eventId = deterministicEventId(projectId, environment, type, event);
            }
            scoped.push({
                projectId,
                projectSlug: payload.metadata?.projectSlug,
                projectName: payload.metadata?.projectName,
                orgId,
                orgSlug: payload.metadata?.orgSlug,
                orgName: payload.metadata?.orgName,
                environment,
                apiKeyName,
                event,
            });
        }
        timings.normalizationMs = normalizationMs;
        timings.validationMs = elapsedSince(validationStartedAt);
        // Route validation rejects to the DLQ intake queue (one message per job).
        // If this send throws, the job fails and retries — rejects are never lost.
        if (rejected.length > 0) {
            const dlqStartedAt = Date.now();
            const dlq = {
                sourceQueue: queue,
                organizationId: orgId,
                projectId,
                environment,
                eventType: type ?? 'unknown',
                payload: rejected,
                failedAt: new Date().toISOString(),
                error: `validation_failed: ${rejected.length} event(s) rejected; first: ${rejected[0]?.detail ?? 'unknown'}`,
            };
            await pgboss.send(INGEST_DLQ_INTAKE_QUEUE, dlq, {});
            timings.dlqEnqueueMs = elapsedSince(dlqStartedAt);
        }
        // 3) Persist all writes for this job through one checked-out client and one transaction.
        let result = {
            totalInserted: 0,
            totalReceived: rawEvents.length,
            perType: {},
            insertedErrors: [],
            outboxInserted: 0,
        };
        let errorDomainEvents = [];
        let dbQueries = 0;
        let dbQueryMs = 0;
        if (scoped.length > 0) {
            // ── Write admission ───────────────────────────────────────────────────
            // Wait here (in memory, FIFO, no timeout) rather than on `pool.connect()`.
            // The permit guarantees a pool connection is available, so
            // `dbConnectionWaitMs` below now measures genuine pool behaviour instead
            // of queueing, and `writeAdmissionWaitMs` isolates admission queueing as
            // its own signal. Splitting the two is what makes saturation diagnosable:
            // high admission wait = not enough write capacity; high connection wait
            // = the pool itself is unhealthy.
            await this.admission.run(async () => {
                const dbConnectionStartedAt = Date.now();
                const client = await this.pool.connect();
                timings.dbConnectionWaitMs = elapsedSince(dbConnectionStartedAt);
                const restoreQuery = instrumentClientQueries(client, (durationMs) => {
                    dbQueries += 1;
                    dbQueryMs += durationMs;
                    this.metrics.recordDbQueryDuration(type ?? 'unknown', durationMs);
                });
                try {
                    const transactionStartedAt = Date.now();
                    const beginStartedAt = Date.now();
                    await client.query('BEGIN');
                    await applyIngestionTransactionSettings(client);
                    timings.beginMs = elapsedSince(beginStartedAt);
                    if (type === 'error') {
                        const errorPrepareStartedAt = Date.now();
                        const errorBatch = scoped.map(s => {
                            const e = s.event;
                            const errorName = errorNameOf(s.event);
                            const fingerprint = errorFingerprint(s.event, errorName);
                            const req = e.context?.request || e.context || {};
                            return {
                                groupParams: {
                                    organizationId: s.orgId,
                                    projectId: s.projectId,
                                    fingerprint,
                                    fingerprintVersion: 2,
                                    eventId: e.eventId,
                                    severity: e.level || e.severity || 'error',
                                    message: e.message,
                                    errorName,
                                    ...(typeof e.release === 'string' ? { release: e.release } : {}),
                                    ...(typeof e.sdk?.version === 'string' ? { sdkVersion: e.sdk.version } : {}),
                                    ...(typeof e.traceId === 'string' ? { traceId: e.traceId } : {}),
                                    ...(typeof e.requestId === 'string' ? { requestId: e.requestId } : {}),
                                    environment: s.environment,
                                    service: typeof e.service === 'string' ? e.service : undefined,
                                    occurredAt: new Date(resolveTimestamp(e)),
                                },
                                eventRecord: {
                                    id: typeof e.id === 'string' ? e.id : randomUUID(),
                                    organization_id: s.orgId,
                                    project_id: s.projectId,
                                    api_key_name: s.apiKeyName ?? '',
                                    environment: s.environment,
                                    event_id: e.eventId,
                                    request_id: e.requestId ?? null,
                                    trace_id: e.traceId ?? null,
                                    span_id: e.spanId ?? null,
                                    parent_span_id: e.parentSpanId ?? null,
                                    session_id: e.sessionId ?? null,
                                    user_id: e.userId ?? e.context?.userId ?? e.user?.id ?? null,
                                    fingerprint,
                                    fingerprint_version: 2,
                                    message: e.message || errorName,
                                    error_name: errorName,
                                    severity: e.level || e.severity || 'error',
                                    mechanism: e.mechanism ?? null,
                                    handled: typeof e.handled === 'boolean' ? e.handled : null,
                                    method: e.method ?? req.method ?? null,
                                    route: e.route ?? req.route ?? null,
                                    url: e.url ?? req.url ?? null,
                                    status_code: typeof e.statusCode === 'number' ? e.statusCode : (typeof req.statusCode === 'number' ? req.statusCode : null),
                                    status_text: e.statusText ?? req.statusText ?? null,
                                    stack_raw: e.stack ? JSON.stringify(e.stack) : null,
                                    breadcrumbs: e.breadcrumbs ? JSON.stringify(e.breadcrumbs) : null,
                                    user_agent: req.headers?.['user-agent'] ?? null,
                                    client_ip: req.headers?.['x-forwarded-for'] ?? req.ip ?? null,
                                    service: typeof e.service === 'string' ? e.service : (typeof req.service === 'string' ? req.service : null),
                                    release: e.release ?? e.metadata?.release ?? null,
                                    server_name: e.serverName ?? e.metadata?.serverName ?? null,
                                    application_name: e.applicationName ?? e.metadata?.applicationName ?? null,
                                    application_version: e.applicationVersion ?? e.metadata?.applicationVersion ?? null,
                                    tags: e.tags ?? {},
                                    extra: e.extra ?? {},
                                    metadata: e.metadata ?? {},
                                    ai_response: e.aiResponse ?? null,
                                    occurred_at: new Date(resolveTimestamp(e)),
                                    payload: e
                                }
                            };
                        });
                        timings.errorPrepareMs = elapsedSince(errorPrepareStartedAt);
                        const insertStartedAt = Date.now();
                        const errorResult = await this.errorIngestionService.ingestBatch(client, errorBatch);
                        timings.insertMs = elapsedSince(insertStartedAt);
                        result.totalInserted = errorResult.inserted;
                        result.totalReceived = errorBatch.length;
                        result.perType = {
                            error: {
                                received: errorBatch.length,
                                inserted: errorResult.inserted,
                                durationMs: timings.insertMs,
                            },
                        };
                        errorDomainEvents = errorResult.domainEvents;
                        if (result.totalInserted > 0) {
                            const outboxStartedAt = Date.now();
                            // Only events the DB actually inserted may produce outbox rows.
                            // Previously the whole `scoped` array was passed, so a batch of
                            // 1 new + 99 redelivered duplicates built a 100-row UNNEST payload
                            // and attempted 100 `alert_runtime_idempotency_keys` inserts that
                            // were guaranteed to be swallowed by ON CONFLICT DO NOTHING. That
                            // is pure write amplification (heap + index + WAL) on the retry
                            // path, which is exactly when the system is already under stress.
                            // `errorResult.domainEvents` is populated once per INSERTED error,
                            // so it is the authoritative inserted set.
                            const insertedKeys = new Set(errorResult.domainEvents.map((domainEvent) => outboxIdentityKey(domainEvent.eventRecord.organization_id, domainEvent.eventRecord.event_id)));
                            const insertedScoped = scoped.filter((candidate) => insertedKeys.has(outboxIdentityKey(candidate.orgId, scopedEventId(candidate))));
                            result.outboxInserted = insertedScoped.length > 0
                                ? await this.writer.appendTelemetryOutbox(insertedScoped, client)
                                : 0;
                            timings.outboxMs = elapsedSince(outboxStartedAt);
                            timings.outboxRowsSkippedDuplicate = scoped.length - insertedScoped.length;
                        }
                    }
                    else {
                        const insertStartedAt = Date.now();
                        result = await this.writer.writeBatchDetailedInTransaction(client, scoped);
                        timings.insertMs = elapsedSince(insertStartedAt);
                        if (result.totalInserted > 0) {
                            const outboxStartedAt = Date.now();
                            result.outboxInserted = await this.writer.appendTelemetryOutbox(scoped, client);
                            timings.outboxMs = elapsedSince(outboxStartedAt);
                        }
                    }
                    const commitStartedAt = Date.now();
                    await client.query('COMMIT');
                    timings.commitMs = elapsedSince(commitStartedAt);
                    timings.transactionMs = elapsedSince(transactionStartedAt);
                    if (errorDomainEvents.length > 0) {
                        const domainEventStartedAt = Date.now();
                        this.errorIngestionService.publishBatchDomainEvents(errorDomainEvents);
                        timings.domainEventMs = elapsedSince(domainEventStartedAt);
                    }
                }
                catch (err) {
                    const rollbackStartedAt = Date.now();
                    await client.query('ROLLBACK').catch(() => undefined);
                    timings.rollbackMs = elapsedSince(rollbackStartedAt);
                    timings.totalProcessingMs = elapsedSince(startedAt);
                    this.log.error({
                        err,
                        phase: 'ingestion_profile_failed',
                        failureClass: ingestionFailureClass(err),
                        sqlState: errorCode(err),
                        queue,
                        eventType: type ?? 'unknown',
                        batchId: payload?.metadata?.batchId,
                        projectId,
                        environment,
                        received: rawEvents.length,
                        batchBytes,
                        validated: scoped.length,
                        rejected: rejected.length,
                        dbQueries,
                        dbQueryMs,
                        queueWaitMs,
                        ...timings,
                    }, 'ingestion batch transaction failed');
                    throw err;
                }
                finally {
                    restoreQuery();
                    client.release();
                }
            }, (waitedMs) => {
                timings.writeAdmissionWaitMs = waitedMs;
                const { inFlight, queued } = this.admission.stats();
                this.metrics.setWriteAdmission?.(inFlight, queued);
            });
        }
        if (result.totalInserted > 0) {
            this.log.info({
                phase: '2_inserted',
                queue,
                eventType: type ?? 'unknown',
                batchId: payload?.metadata?.batchId,
                projectId,
                environment,
                received: rawEvents.length,
                rejected: rejected.length,
                inserted: result.totalInserted,
                durationMs: Date.now() - startedAt,
            }, '[Phase 2/4] Ingest event stored');
        }
        // 5) Usage accounting (inserted rows only — duplicates are never billed).
        if (result.totalInserted > 0 && orgId && projectId) {
            const usageStartedAt = Date.now();
            this.usage.increment(projectId, orgId, `billing:events:${type}`, result.totalInserted);
            this.usage.increment(projectId, orgId, 'events', result.totalInserted, {
                apiKeyId: payload.metadata.apiKeyId || null,
                eventType: type ?? 'all',
            });
            timings.usageAccountingMs = elapsedSince(usageStartedAt);
        }
        // 6) Metrics.
        const duplicateCount = Math.max(0, result.totalReceived - result.totalInserted);
        const e2eMs = Number.isFinite(receivedAt) ? Math.max(0, Date.now() - receivedAt) : null;
        timings.totalProcessingMs = elapsedSince(startedAt);
        if (queueWaitMs != null)
            this.metrics.recordStage('queue_wait', type ?? 'unknown', queueWaitMs);
        for (const [stage, ms] of Object.entries(timings)) {
            this.metrics.recordStage(stage, type ?? 'unknown', ms);
        }
        for (const [eventType, stats] of Object.entries(result.perType)) {
            this.metrics.recordStage(`perType.${eventType}.durationMs`, eventType, stats.durationMs);
        }
        this.metrics.recordDbQueries(type ?? 'unknown', dbQueries);
        this.metrics.recordBatchShape(type ?? 'unknown', rawEvents.length, batchBytes);
        this.metrics.recordDuplicates(queue, type ?? 'unknown', duplicateCount);
        this.metrics.recordProcessed(queue, type ?? 'unknown', rawEvents.length, result.totalInserted, rejected.length, Date.now() - startedAt, e2eMs, batchBytes);
        this.log.info({
            phase: 'ingestion_profile',
            queue,
            eventType: type ?? 'unknown',
            batchId: payload?.metadata?.batchId,
            projectId,
            environment,
            received: rawEvents.length,
            batchBytes,
            validated: scoped.length,
            rejected: rejected.length,
            inserted: result.totalInserted,
            duplicates: duplicateCount,
            outboxInserted: result.outboxInserted ?? 0,
            dbQueries,
            dbQueryMs,
            queueWaitMs,
            perType: result.perType,
            ...timings,
        }, 'ingestion batch profile');
        if (rejected.length > 0 || result.totalInserted !== result.totalReceived) {
            this.log.debug({
                queue, type, received: rawEvents.length, inserted: result.totalInserted,
                rejected: rejected.length, duplicates: duplicateCount,
            }, 'ingest job processed with drops');
        }
        return {
            received: rawEvents.length,
            validated: scoped.length,
            rejected: rejected.length,
            inserted: result.totalInserted,
            duplicates: duplicateCount,
            outboxInserted: result.outboxInserted ?? 0,
            perType: result.perType,
            dbQueries,
            dbQueryMs,
            queueWaitMs,
            timings,
        };
    }
}
//# sourceMappingURL=event-processor.js.map