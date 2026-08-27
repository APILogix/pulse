/**
 * Worker observability: in-process metrics registry + a tiny node:http scrape
 * endpoint (Prometheus text format, hand-rolled — plain Maps, no extra deps).
 *
 *   GET /metrics — per-queue counters {jobs_processed, jobs_failed,
 *                  events_received, events_inserted, events_rejected,
 *                  events_deferred, events_duplicate}, org/worker in-flight gauges, processing + e2e
 *                  latency {count,sum,max,p50,p95,p99,p99.9} per type, DLQ intake count, usage
 *                  rollup last-run stats, DB pool gauges, and a live pg-boss
 *                  queue-depth probe.
 *   GET /healthz — { uptime, queues } JSON for liveness probes.
 *
 * The server is best-effort: a bind failure logs a warning and the worker
 * keeps running without metrics. The queue-depth probe is cached ~5s so a
 * scrape storm cannot hammer the pgboss.job table.
 */
import { createServer } from 'http';
import { env } from '../../../config/env.js';
import { ALL_INGEST_QUEUES, ingestQueueDepth, } from '../queue/ingest-queues.js';
const DEPTH_CACHE_MS = 5_000;
const LATENCY_SAMPLE_LIMIT = 2_048;
const LATENCY_QUANTILES = [
    ['0.5', 0.5],
    ['0.95', 0.95],
    ['0.99', 0.99],
    ['0.999', 0.999],
];
function emptyQueueCounters() {
    return {
        jobsProcessed: 0,
        jobsFailed: 0,
        jobsRetried: 0,
        eventsReceived: 0,
        eventsInserted: 0,
        eventsRejected: 0,
        eventsDeferred: 0,
        eventsFailed: 0,
    };
}
function esc(v) {
    return v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}
function emptyThroughputCounters() {
    return {
        batches: 0,
        eventsReceived: 0,
        eventsInserted: 0,
        eventsRejected: 0,
        bytes: 0,
    };
}
function quantile(samples, q) {
    if (samples.length === 0)
        return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.ceil(q * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))] ?? 0;
}
/**
 * In-process metrics registry. All methods are synchronous and never throw —
 * recording a metric must never break a job.
 */
export class WorkerMetrics {
    queues = new Map();
    processingMs = new Map();
    e2eMs = new Map();
    stageMs = new Map();
    dbQueryMs = new Map();
    dbQueriesPerBatch = new Map();
    eventsPerBatch = new Map();
    bytesPerBatch = new Map();
    orgInFlight = new Map();
    workerInFlight = new Map();
    workerCapacity = new Map();
    fairnessStarvationAdmissions = new Map();
    eventDuplicates = new Map();
    eventFailures = new Map();
    throughput = new Map();
    // Fairness gate counters (spec: deferredJobs / fairnessProcessed).
    deferredJobs = 0;
    fairnessProcessed = 0;
    dlqIntake = 0;
    rollupRuns = 0;
    rollupFailures = 0;
    rollupLastRunAt = null;
    rollupLastDurationMs = 0;
    rollupLastStagingRows = 0;
    rollupLastEvents = 0;
    rollupLastOrgs = 0;
    rollupLastProjects = 0;
    queue(name) {
        let q = this.queues.get(name);
        if (!q) {
            q = emptyQueueCounters();
            this.queues.set(name, q);
        }
        return q;
    }
    throughputCounter(queue, type) {
        const key = `${queue}|${type}`;
        let counter = this.throughput.get(key);
        if (!counter) {
            counter = emptyThroughputCounters();
            this.throughput.set(key, counter);
        }
        return counter;
    }
    // Error Grouping Metrics
    errorGroupsCreated = 0;
    errorGroupsReused = 0;
    errorRegressions = 0;
    errorDuplicates = 0;
    /**
     * Times the set-based error grouper bailed out to per-event resolution because
     * a matched group had `merged_into` set. This is the only remaining O(N)
     * database path in error ingestion, so a non-trivial rate here is the signal
     * that error-batch query count has degraded from O(1) to ~3N.
     */
    errorGroupMergeFallbacks = 0;
    errorGroupMergeFallbackEvents = 0;
    // ── Write admission (DB concurrency ceiling) ──────────────────────────────
    /** Configured concurrent ingest transactions permitted. */
    writePermits = 0;
    /** Permits currently held (i.e. transactions in flight). */
    writeInFlight = 0;
    /** Handlers waiting for a permit — the saturation signal. */
    writeQueued = 0;
    /** High-water mark of `writeQueued`, so short bursts are not missed by scrapes. */
    writeQueuedPeak = 0;
    errorGroupLookupMs = new Map();
    errorGroupUpsertMs = new Map();
    errorTransactionMs = new Map();
    errorDomainEventMs = new Map();
    observe(map, key, ms) {
        if (!Number.isFinite(ms) || ms < 0)
            return;
        let s = map.get(key);
        if (!s) {
            s = { count: 0, sum: 0, max: 0, samples: [] };
            map.set(key, s);
        }
        s.count += 1;
        s.sum += ms;
        if (ms > s.max)
            s.max = ms;
        s.samples.push(ms);
        if (s.samples.length > LATENCY_SAMPLE_LIMIT) {
            s.samples.splice(0, s.samples.length - LATENCY_SAMPLE_LIMIT);
        }
    }
    recordProcessed(queue, type, eventsReceived, inserted, rejected, processingMs, e2eMsVal, batchBytes = 0) {
        const q = this.queue(queue);
        q.jobsProcessed += 1;
        q.eventsReceived += eventsReceived;
        q.eventsInserted += inserted;
        q.eventsRejected += rejected;
        const t = this.throughputCounter(queue, type);
        t.batches += 1;
        t.eventsReceived += eventsReceived;
        t.eventsInserted += inserted;
        t.eventsRejected += rejected;
        if (Number.isFinite(batchBytes) && batchBytes > 0)
            t.bytes += Math.trunc(batchBytes);
        this.observe(this.processingMs, type, processingMs);
        if (e2eMsVal != null)
            this.observe(this.e2eMs, type, e2eMsVal);
    }
    recordStage(stage, type, ms) {
        this.observe(this.stageMs, `${stage}|${type}`, ms);
    }
    recordDbQueries(type, queries) {
        this.observe(this.dbQueriesPerBatch, type, queries);
    }
    recordDbQueryDuration(type, ms) {
        this.observe(this.dbQueryMs, type, ms);
    }
    recordBatchShape(type, events, bytes) {
        this.observe(this.eventsPerBatch, type, events);
        this.observe(this.bytesPerBatch, type, bytes);
    }
    recordFailed(queue, eventsReceived, type = 'unknown', reason = 'unknown') {
        const q = this.queue(queue);
        q.jobsFailed += 1;
        q.eventsReceived += eventsReceived;
        q.eventsFailed += eventsReceived;
        if (eventsReceived > 0) {
            const key = `${queue}|${type}|${reason}`;
            this.eventFailures.set(key, (this.eventFailures.get(key) ?? 0) + eventsReceived);
        }
    }
    recordRetry(queue, count = 1) {
        this.queue(queue).jobsRetried += count;
    }
    recordDuplicates(queue, type, count) {
        if (!Number.isFinite(count) || count <= 0)
            return;
        const key = `${queue}|${type}`;
        this.eventDuplicates.set(key, (this.eventDuplicates.get(key) ?? 0) + Math.trunc(count));
    }
    recordDeferred(queue, events) {
        this.queue(queue).eventsDeferred += events;
        this.deferredJobs += 1;
    }
    recordFairnessProcessed() {
        this.fairnessProcessed += 1;
    }
    recordFairnessStarvationAdmission(queue, type) {
        const key = `${queue}|${type}`;
        this.fairnessStarvationAdmissions.set(key, (this.fairnessStarvationAdmissions.get(key) ?? 0) + 1);
    }
    recordDlqIntake(count = 1) {
        this.dlqIntake += count;
    }
    setOrgInFlight(orgId, count) {
        if (count <= 0)
            this.orgInFlight.delete(orgId);
        else
            this.orgInFlight.set(orgId, count);
    }
    setWorkerInFlight(queue, type, count) {
        const key = `${queue}|${type}`;
        if (count <= 0)
            this.workerInFlight.delete(key);
        else
            this.workerInFlight.set(key, count);
    }
    setWorkerCapacity(queue, type, slots) {
        if (!Number.isFinite(slots) || slots <= 0)
            return;
        this.workerCapacity.set(`${queue}|${type}`, Math.trunc(slots));
    }
    recordErrorGroup(isNew, isRegression) {
        if (isNew)
            this.errorGroupsCreated += 1;
        else
            this.errorGroupsReused += 1;
        if (isRegression)
            this.errorRegressions += 1;
    }
    recordErrorDuplicate() {
        this.errorDuplicates += 1;
    }
    /** One batch fell back to per-event group resolution; `events` is that batch's size. */
    recordErrorGroupMergeFallback(events) {
        this.errorGroupMergeFallbacks += 1;
        if (Number.isFinite(events) && events > 0) {
            this.errorGroupMergeFallbackEvents += Math.trunc(events);
        }
    }
    /** Configured write-admission permits (reported once at worker construction). */
    setWritePermits(permits) {
        if (!Number.isFinite(permits) || permits <= 0)
            return;
        this.writePermits = Math.trunc(permits);
    }
    /**
     * Current admission occupancy. Called on every admit, so the peak is tracked
     * here rather than sampled — a burst that fills and drains between two Prometheus
     * scrapes would otherwise be invisible, which is exactly the event we most need
     * to see when diagnosing a latency spike.
     */
    setWriteAdmission(inFlight, queued) {
        this.writeInFlight = Number.isFinite(inFlight) ? Math.max(0, Math.trunc(inFlight)) : 0;
        this.writeQueued = Number.isFinite(queued) ? Math.max(0, Math.trunc(queued)) : 0;
        if (this.writeQueued > this.writeQueuedPeak)
            this.writeQueuedPeak = this.writeQueued;
    }
    recordErrorLatencies(lookup, upsert, transaction, domain) {
        if (lookup !== null)
            this.observe(this.errorGroupLookupMs, 'lookup', lookup);
        if (upsert !== null)
            this.observe(this.errorGroupUpsertMs, 'upsert', upsert);
        if (transaction !== null)
            this.observe(this.errorTransactionMs, 'transaction', transaction);
        if (domain !== null)
            this.observe(this.errorDomainEventMs, 'domain_event', domain);
    }
    recordRollupSuccess(stats) {
        this.rollupRuns += 1;
        this.rollupLastRunAt = new Date().toISOString();
        this.rollupLastDurationMs = stats.durationMs;
        this.rollupLastStagingRows = stats.stagingRows;
        this.rollupLastEvents = stats.events;
        this.rollupLastOrgs = stats.orgs;
        this.rollupLastProjects = stats.projects;
    }
    recordRollupFailure(durationMs) {
        this.rollupRuns += 1;
        this.rollupFailures += 1;
        this.rollupLastRunAt = new Date().toISOString();
        this.rollupLastDurationMs = durationMs;
    }
    /** Render the Prometheus text exposition format (v0.0.4). */
    render(depth, dbPools = []) {
        const out = [];
        const counter = (name, help, value, labels) => {
            out.push(`# HELP ${name} ${help}`);
            out.push(`# TYPE ${name} counter`);
            out.push(formatSample(name, value, labels));
        };
        const gauge = (name, help, value, labels) => {
            out.push(`# HELP ${name} ${help}`);
            out.push(`# TYPE ${name} gauge`);
            out.push(formatSample(name, value, labels));
        };
        // Error Grouping output
        counter('ingest_error_groups_created_total', 'New error groups created.', this.errorGroupsCreated);
        counter('ingest_error_groups_reused_total', 'Existing error groups reused.', this.errorGroupsReused);
        counter('ingest_error_regressions_total', 'Resolved error groups regressed to open.', this.errorRegressions);
        counter('ingest_error_duplicates_total', 'Duplicate error events rejected.', this.errorDuplicates);
        counter('ingest_error_group_merge_fallback_total', 'Error batches that fell back to per-event group resolution (query count degrades to O(N)).', this.errorGroupMergeFallbacks);
        counter('ingest_error_group_merge_fallback_events_total', 'Error events processed through the per-event group resolution fallback.', this.errorGroupMergeFallbackEvents);
        // ── Write admission ────────────────────────────────────────────────────
        // Read these three together to tell capacity problems apart from DB problems:
        //   queued > 0 sustained          -> not enough write capacity (raise permits/pool)
        //   in_flight == permits, queued 0 -> perfectly saturated, this is the goal
        //   in_flight < permits but slow   -> the database is the bottleneck, not admission
        gauge('ingest_write_admission_permits', 'Configured ceiling on concurrent ingest database transactions.', this.writePermits);
        gauge('ingest_write_admission_in_flight', 'Ingest database transactions currently holding an admission permit.', this.writeInFlight);
        gauge('ingest_write_admission_queued', 'Job handlers waiting for a write-admission permit.', this.writeQueued);
        gauge('ingest_write_admission_queued_peak', 'High-water mark of handlers waiting for a write-admission permit.', this.writeQueuedPeak);
        const queueMetrics = [
            ['jobsProcessed', 'ingest_jobs_processed_total', 'Jobs completed by the ingestion workers.'],
            ['jobsFailed', 'ingest_jobs_failed_total', 'Jobs that failed (pg-boss retries them).'],
            ['jobsRetried', 'ingest_jobs_retried_total', 'Jobs delivered to ingestion workers after one or more previous attempts.'],
            ['eventsReceived', 'ingest_events_received_total', 'Raw events entering the processing pipeline.'],
            ['eventsInserted', 'ingest_events_inserted_total', 'Events actually persisted (duplicates excluded).'],
            ['eventsRejected', 'ingest_events_rejected_total', 'Events rejected by validation (routed to DLQ).'],
            ['eventsDeferred', 'ingest_events_deferred_total', 'Events deferred by the tenant-fairness gate.'],
            ['eventsFailed', 'ingest_events_failed_total', 'Events in jobs that failed and will be retried or dead-lettered by pg-boss.'],
        ];
        const allQueues = new Set([...ALL_INGEST_QUEUES, ...this.queues.keys()]);
        for (const [key, name, help] of queueMetrics) {
            out.push(`# HELP ${name} ${help}`);
            out.push(`# TYPE ${name} counter`);
            for (const q of allQueues) {
                out.push(formatSample(name, this.queue(q)[key], { queue: q }));
            }
        }
        const throughputMetrics = [
            ['batches', 'ingest_batches_processed_by_type_total', 'Successful worker batches by queue and event type; rate() gives batches/sec.'],
            ['eventsReceived', 'ingest_events_received_by_type_total', 'Raw events in successful worker batches by queue and event type; rate() gives received events/sec.'],
            ['eventsInserted', 'ingest_events_inserted_by_type_total', 'Persisted events by queue and event type; rate() gives durable inserted events/sec.'],
            ['eventsRejected', 'ingest_events_rejected_by_type_total', 'Validation rejects in successful worker batches by queue and event type; rate() gives rejects/sec.'],
            ['bytes', 'ingest_batch_bytes_total', 'Serialized event payload bytes in successful worker batches by queue and event type; rate() gives bytes/sec.'],
        ];
        for (const [field, name, help] of throughputMetrics) {
            out.push(`# HELP ${name} ${help}`);
            out.push(`# TYPE ${name} counter`);
            for (const [key, counts] of this.throughput) {
                const [queue, type] = key.split('|', 2);
                out.push(formatSample(name, counts[field], {
                    queue: queue ?? 'unknown',
                    type: type ?? 'unknown',
                }));
            }
        }
        out.push('# HELP ingest_events_duplicate_total Events dropped by idempotency/deduplication after successful batch persistence.');
        out.push('# TYPE ingest_events_duplicate_total counter');
        for (const [key, n] of this.eventDuplicates) {
            const [queue, type] = key.split('|', 2);
            out.push(formatSample('ingest_events_duplicate_total', n, {
                queue: queue ?? 'unknown',
                type: type ?? 'unknown',
            }));
        }
        out.push('# HELP ingest_events_failed_by_reason_total Events in failed ingest jobs by queue, event type, and fixed failure reason.');
        out.push('# TYPE ingest_events_failed_by_reason_total counter');
        for (const [key, n] of this.eventFailures) {
            const [queue, type, reason] = key.split('|', 3);
            out.push(formatSample('ingest_events_failed_by_reason_total', n, {
                queue: queue ?? 'unknown',
                type: type ?? 'unknown',
                reason: reason ?? 'unknown',
            }));
        }
        counter('ingest_fairness_deferred_jobs_total', 'Jobs deferred by the tenant-fairness gate.', this.deferredJobs);
        counter('ingest_fairness_processed_jobs_total', 'Jobs admitted by the tenant-fairness gate and processed.', this.fairnessProcessed);
        counter('ingest_dlq_intake_total', 'Dead-lettered jobs persisted to ingestion_dead_letter_jobs.', this.dlqIntake);
        out.push('# HELP ingest_fairness_starvation_guard_admissions_total Jobs admitted after reaching the fairness max-deferral guard.');
        out.push('# TYPE ingest_fairness_starvation_guard_admissions_total counter');
        for (const [key, n] of this.fairnessStarvationAdmissions) {
            const [queue, type] = key.split('|', 2);
            out.push(formatSample('ingest_fairness_starvation_guard_admissions_total', n, {
                queue: queue ?? 'unknown',
                type: type ?? 'unknown',
            }));
        }
        out.push('# HELP ingest_org_inflight_jobs Jobs currently being processed per organization (per process).');
        out.push('# TYPE ingest_org_inflight_jobs gauge');
        for (const [orgId, n] of this.orgInFlight) {
            out.push(formatSample('ingest_org_inflight_jobs', n, { org_id: orgId }));
        }
        out.push('# HELP ingest_worker_inflight_jobs Jobs currently running in this worker process.');
        out.push('# TYPE ingest_worker_inflight_jobs gauge');
        for (const [key, n] of this.workerInFlight) {
            const [queue, type] = key.split('|', 2);
            out.push(formatSample('ingest_worker_inflight_jobs', n, { queue: queue ?? 'unknown', type: type ?? 'unknown' }));
        }
        out.push('# HELP ingest_worker_configured_slots Configured maximum local job slots for this worker process.');
        out.push('# TYPE ingest_worker_configured_slots gauge');
        for (const [key, slots] of this.workerCapacity) {
            const [queue, type] = key.split('|', 2);
            out.push(formatSample('ingest_worker_configured_slots', slots, { queue: queue ?? 'unknown', type: type ?? 'unknown' }));
        }
        const latency = (name, help, map, labeler = (type) => ({ type })) => {
            for (const suffix of ['count', 'sum', 'max']) {
                out.push(`# HELP ${name}_${suffix} ${help} (${suffix}).`);
                out.push(`# TYPE ${name}_${suffix} ${suffix === 'max' ? 'gauge' : 'counter'}`);
                for (const [key, s] of map) {
                    out.push(formatSample(`${name}_${suffix}`, s[suffix], labeler(key)));
                }
            }
            out.push(`# HELP ${name}_quantile ${help} rolling quantile over the last ${LATENCY_SAMPLE_LIMIT} observations.`);
            out.push(`# TYPE ${name}_quantile gauge`);
            for (const [key, s] of map) {
                for (const [label, q] of LATENCY_QUANTILES) {
                    out.push(formatSample(`${name}_quantile`, quantile(s.samples, q), { ...labeler(key), quantile: label }));
                }
            }
        };
        latency('ingest_processing_latency_ms', 'Worker-side job processing latency', this.processingMs);
        latency('ingest_e2e_latency_ms', 'End-to-end latency (now minus gateway receivedAt)', this.e2eMs);
        latency('ingest_stage_latency_ms', 'Worker-side ingestion stage latency', this.stageMs, (key) => {
            const [stage, type] = key.split('|', 2);
            return { stage: stage ?? 'unknown', type: type ?? 'unknown' };
        });
        latency('ingest_db_query_duration_ms', 'Individual SQL query duration inside worker batch transactions', this.dbQueryMs);
        latency('ingest_db_queries_per_batch', 'SQL statements executed per worker batch', this.dbQueriesPerBatch);
        latency('ingest_events_per_batch', 'Events received per worker batch', this.eventsPerBatch);
        latency('ingest_batch_bytes', 'Serialized event payload bytes received per worker batch', this.bytesPerBatch);
        latency('ingest_error_group_lookup_ms', 'Error Group lookup latency', this.errorGroupLookupMs);
        latency('ingest_error_group_upsert_ms', 'Error Group upsert latency', this.errorGroupUpsertMs);
        latency('ingest_error_transaction_ms', 'Error Group total transaction latency', this.errorTransactionMs);
        latency('ingest_error_domain_event_ms', 'Error Group domain event dispatch latency', this.errorDomainEventMs);
        counter('ingest_rollup_runs_total', 'Usage rollup executions.', this.rollupRuns);
        counter('ingest_rollup_failures_total', 'Usage rollup executions that failed (transaction rolled back).', this.rollupFailures);
        gauge('ingest_rollup_last_duration_ms', 'Duration of the last usage rollup run.', this.rollupLastDurationMs);
        gauge('ingest_rollup_last_staging_rows', 'billing:% staging rows consumed by the last rollup.', this.rollupLastStagingRows);
        gauge('ingest_rollup_last_events', 'Events rolled up by the last usage rollup.', this.rollupLastEvents);
        gauge('ingest_rollup_last_orgs', 'Organizations updated by the last usage rollup.', this.rollupLastOrgs);
        gauge('ingest_rollup_last_projects', 'Org/project scopes updated by the last usage rollup.', this.rollupLastProjects);
        if (this.rollupLastRunAt) {
            gauge('ingest_rollup_last_run_timestamp_seconds', 'Wall clock time of the last usage rollup run (unix seconds).', Math.floor(Date.parse(this.rollupLastRunAt) / 1000));
        }
        if (depth) {
            gauge('ingest_queue_depth_pending', 'Jobs waiting to be picked up (created + retry).', depth.pending);
            gauge('ingest_queue_depth_ready', 'Pending/retry jobs that are runnable now.', depth.ready);
            gauge('ingest_queue_depth_deferred', 'Pending/retry jobs delayed by retry or fairness scheduling.', depth.deferred);
            gauge('ingest_queue_depth_active', 'Jobs currently being processed.', depth.active);
            gauge('ingest_queue_depth_failed', 'Failed jobs (pre-dead-letter).', depth.failed);
            gauge('ingest_dlq_retained_jobs', 'Persisted unreplayed ingestion dead-letter rows.', depth.deadLettered);
            gauge('ingest_queue_oldest_pending_job_age_ms', 'Age of the oldest pending/retry ingest job across all queues.', depth.oldestPendingAgeMs ?? 0);
            out.push('# HELP ingest_queue_depth_jobs Jobs per queue and state.');
            out.push('# TYPE ingest_queue_depth_jobs gauge');
            for (const row of depth.perQueue) {
                out.push(formatSample('ingest_queue_depth_jobs', row.count, { queue: row.queue, state: row.state }));
            }
            out.push('# HELP ingest_queue_ready_jobs Runnable pending/retry jobs per queue and state.');
            out.push('# TYPE ingest_queue_ready_jobs gauge');
            for (const row of depth.perQueue) {
                if (row.ready <= 0)
                    continue;
                out.push(formatSample('ingest_queue_ready_jobs', row.ready, { queue: row.queue, state: row.state }));
            }
            out.push('# HELP ingest_queue_deferred_jobs Pending/retry jobs delayed by retry or fairness scheduling per queue and state.');
            out.push('# TYPE ingest_queue_deferred_jobs gauge');
            for (const row of depth.perQueue) {
                if (row.deferred <= 0)
                    continue;
                out.push(formatSample('ingest_queue_deferred_jobs', row.deferred, { queue: row.queue, state: row.state }));
            }
            out.push('# HELP ingest_dlq_retained_jobs_per_queue Persisted unreplayed ingestion dead-letter rows by source queue.');
            out.push('# TYPE ingest_dlq_retained_jobs_per_queue gauge');
            for (const row of depth.dlqPerQueue) {
                out.push(formatSample('ingest_dlq_retained_jobs_per_queue', row.count, { queue: row.queue }));
            }
            out.push('# HELP ingest_queue_oldest_pending_job_age_ms_per_queue Age of the oldest pending/retry job per queue/state.');
            out.push('# TYPE ingest_queue_oldest_pending_job_age_ms_per_queue gauge');
            for (const row of depth.perQueue) {
                if (row.oldestPendingAgeMs == null)
                    continue;
                out.push(formatSample('ingest_queue_oldest_pending_job_age_ms_per_queue', row.oldestPendingAgeMs, {
                    queue: row.queue,
                    state: row.state,
                }));
            }
        }
        if (dbPools.length > 0) {
            out.push('# HELP ingest_db_pool_connections PostgreSQL pool connection counts observed by the ingestion worker.');
            out.push('# TYPE ingest_db_pool_connections gauge');
            for (const pool of dbPools) {
                const inUse = Math.max(0, pool.total - pool.idle);
                out.push(formatSample('ingest_db_pool_connections', pool.total, { pool: pool.name, state: 'total' }));
                out.push(formatSample('ingest_db_pool_connections', pool.idle, { pool: pool.name, state: 'idle' }));
                out.push(formatSample('ingest_db_pool_connections', inUse, { pool: pool.name, state: 'in_use' }));
                out.push(formatSample('ingest_db_pool_connections', pool.waiting, { pool: pool.name, state: 'waiting' }));
            }
        }
        out.push('');
        return out.join('\n');
    }
}
function formatSample(name, value, labels) {
    if (!labels || Object.keys(labels).length === 0)
        return `${name} ${value}`;
    const inner = Object.entries(labels)
        .map(([k, v]) => `${k}="${esc(v)}"`)
        .join(',');
    return `${name}{${inner}} ${value}`;
}
/**
 * Tiny HTTP server exposing /metrics and /healthz on
 * env.INGESTION_WORKER_METRICS_PORT. Bind failures are logged as warnings and
 * never crash the worker.
 */
export class MetricsServer {
    metrics;
    pool;
    log;
    dbPools;
    server = null;
    depthCache = null;
    constructor(metrics, pool, log, dbPools = [{ name: 'primary', pool }]) {
        this.metrics = metrics;
        this.pool = pool;
        this.log = log;
        this.dbPools = dbPools;
    }
    start() {
        try {
            this.server = createServer((req, res) => void this.handle(req, res));
            this.server.on('error', (err) => {
                this.log.warn({ err, port: env.INGESTION_WORKER_METRICS_PORT }, 'metrics server error — continuing without metrics');
            });
            this.server.listen(env.INGESTION_WORKER_METRICS_PORT, '0.0.0.0', () => {
                this.log.info({ port: env.INGESTION_WORKER_METRICS_PORT }, 'metrics server listening');
            });
        }
        catch (err) {
            this.log.warn({ err }, 'metrics server failed to start — continuing without metrics');
            this.server = null;
        }
    }
    async handle(req, res) {
        try {
            const path = (req.url ?? '').split('?')[0];
            if (req.method === 'GET' && path === '/metrics') {
                const depth = await this.depthSnapshot();
                res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
                res.end(this.metrics.render(depth, this.dbPoolSnapshot()));
                return;
            }
            if (req.method === 'GET' && path === '/healthz') {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ status: 'ok', uptime: process.uptime(), queues: ALL_INGEST_QUEUES }));
                return;
            }
            res.writeHead(404, { 'content-type': 'text/plain' });
            res.end('not found');
        }
        catch (err) {
            this.log.warn({ err }, 'metrics request failed');
            res.writeHead(500, { 'content-type': 'text/plain' });
            res.end('internal error');
        }
    }
    async depthSnapshot() {
        if (this.depthCache && Date.now() - this.depthCache.at < DEPTH_CACHE_MS) {
            return this.depthCache.snap;
        }
        const snap = await ingestQueueDepth(this.pool).catch(() => null);
        if (snap)
            this.depthCache = { at: Date.now(), snap };
        return snap;
    }
    dbPoolSnapshot() {
        return this.dbPools.map(({ name, pool }) => ({
            name,
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
        }));
    }
    async stop() {
        const server = this.server;
        if (!server)
            return;
        this.server = null;
        // Drop idle keep-alive sockets so close() cannot hang on them (Node 18.2+).
        const loose = server;
        loose.closeAllConnections?.();
        loose.closeIdleConnections?.();
        await new Promise((resolve) => server.close(() => resolve()));
    }
}
//# sourceMappingURL=metrics-server.js.map