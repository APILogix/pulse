/**
 * Enterprise ingestion queue contract (pg-boss).
 *
 * Single source of truth shared by the HTTP gateway (producer) and the worker
 * process (consumer). Both sides MUST import queue names, payload shapes and
 * priority math from here — never redefine them locally.
 *
 * Architecture (see docs/enterprise-ingestion-architecture.md):
 *   - One public gateway; internally one pg-boss queue per SDK event type
 *     (`ingest.<type>`) so pipelines scale, retry and fail independently.
 *   - Priority = plan weight + type urgency. Higher wins. Enterprise traffic
 *     can never starve behind Free-tier floods, and errors always outrank
 *     metrics/profiles within a tier.
 *   - Tenant fairness is enforced worker-side (per-org in-flight budgets in
 *     worker-registry.ts) because pg-boss priorities alone cannot stop a
 *     single tenant monopolizing a queue's workers.
 *   - Failed jobs land (after retries + expiry) in `ingest.dlq-intake`, whose
 *     worker persists them into `ingestion_dead_letter_jobs` for ops replay.
 */
import { pgboss } from '../../../lib/pgboss.js';
import { logger } from '../../../config/logger.js';
import { env } from '../../../config/env.js';
const qLogger = logger.child({ component: 'ingest-queues' });
// ─── Queue names ────────────────────────────────────────────────────────────
export const INGEST_QUEUE_PREFIX = 'ingest.';
export const INGEST_QUEUES = {
    error: 'ingest.error',
    message: 'ingest.message',
    request: 'ingest.request',
    span: 'ingest.span',
    trace: 'ingest.trace',
    metric: 'ingest.metric',
    log: 'ingest.log',
    profile: 'ingest.profile',
    cron_checkin: 'ingest.cron_checkin',
    replay: 'ingest.replay',
};
export const ALL_INGEST_QUEUES = Object.values(INGEST_QUEUES);
/** Shared dead-letter intake queue for every ingest.* queue. */
export const INGEST_DLQ_INTAKE_QUEUE = 'ingest.dlq-intake';
/** Singleton cron queue driving the org/project usage rollup. */
export const INGEST_USAGE_ROLLUP_QUEUE = 'ingest.usage-rollup';
export function ingestQueueFor(eventType) {
    return INGEST_QUEUES[eventType] ?? `${INGEST_QUEUE_PREFIX}error`;
}
export const PLAN_TIERS = [
    'free',
    'starter',
    'growth',
    'business',
    'enterprise',
];
/** Plan weight dominates priority: a higher tier ALWAYS outranks a lower one. */
export const PLAN_WEIGHT = {
    enterprise: 1000,
    business: 800,
    growth: 600,
    starter: 400,
    free: 200,
};
/** Type urgency breaks ties within a tier: actionable signals first. */
export const TYPE_URGENCY = {
    error: 100,
    message: 100,
    cron_checkin: 100,
    request: 50,
    span: 50,
    trace: 50,
    log: 30,
    metric: 20,
    profile: 10,
    replay: 10,
};
/**
 * Per-org in-flight budget per worker process, by plan tier. This is the
 * tenant-fairness knob: within a tier, one org may hold at most this many
 * concurrently processing jobs before its jobs are deferred (aged) so other
 * tenants' jobs run first.
 */
export const TENANT_INFLIGHT_LIMIT = {
    enterprise: 24,
    business: 16,
    growth: 8,
    starter: 4,
    free: 2,
};
/** Priority boost granted per fairness deferral so aged jobs win eventually. */
export const FAIRNESS_AGE_BOOST = 25;
export function normalizePlanTier(raw) {
    return raw === 'enterprise' || raw === 'business' || raw === 'growth' || raw === 'starter'
        ? raw
        : 'free';
}
export function jobPriority(planTier, eventType, deferCount = 0) {
    return PLAN_WEIGHT[planTier] + TYPE_URGENCY[eventType] + deferCount * FAIRNESS_AGE_BOOST;
}
// ─── Queue provisioning ─────────────────────────────────────────────────────
export function ingestQueueOptions() {
    return {
        retryLimit: env.INGESTION_JOB_RETRY_LIMIT,
        retryDelay: env.INGESTION_JOB_RETRY_DELAY_SECONDS,
        retryBackoff: true,
        expireInSeconds: env.INGESTION_JOB_EXPIRE_SECONDS,
        deadLetter: INGEST_DLQ_INTAKE_QUEUE,
    };
}
/** createQueue is idempotent; swallow races when several processes boot. */
export async function safeCreateQueue(name, options) {
    const boss = pgboss;
    if (typeof boss.createQueue === 'function') {
        await boss.createQueue(name, options).catch((err) => {
            qLogger.debug({ err, queue: name }, 'createQueue skipped (exists or unsupported)');
        });
    }
}
/** Provision every ingest queue + shared DLQ intake. Call after pgboss.start(). */
export async function provisionIngestQueues() {
    for (const name of ALL_INGEST_QUEUES) {
        await safeCreateQueue(name, ingestQueueOptions());
    }
    await safeCreateQueue(INGEST_DLQ_INTAKE_QUEUE, {
        retryLimit: 5,
        retryDelay: 30,
        retryBackoff: true,
        expireInSeconds: 3600,
    });
    await safeCreateQueue(INGEST_USAGE_ROLLUP_QUEUE);
}
/**
 * Enqueue a tenant-scoped batch as one pg-boss job per (type, chunk). Uses the
 * v12 bulk `insert` when available, falling back to per-job `send`.
 *
 * Durability contract: once this resolves, events survive a crash of any
 * process. That is the ONLY hard work the gateway is allowed to do.
 */
export async function enqueueIngestJobs(jobs) {
    const jobIds = [];
    let enqueuedEvents = 0;
    if (jobs.length === 0)
        return { jobIds, enqueuedEvents };
    const boss = pgboss;
    // Group by queue so we can use one bulk insert per queue.
    const byQueue = new Map();
    for (const job of jobs) {
        const list = byQueue.get(job.queue) ?? [];
        list.push({ data: job.payload, priority: job.priority });
        byQueue.set(job.queue, list);
    }
    for (const [queue, items] of byQueue) {
        if (typeof boss.insert === 'function') {
            try {
                const ids = await boss.insert(queue, items);
                if (ids)
                    jobIds.push(...ids);
                enqueuedEvents += items.reduce((n, i) => n + i.data.events.length, 0);
                continue;
            }
            catch (err) {
                qLogger.warn({ err, queue }, 'bulk insert failed; falling back to send()');
            }
        }
        for (const item of items) {
            const id = (await pgboss.send(queue, item.data, { priority: item.priority }));
            if (id) {
                jobIds.push(id);
                enqueuedEvents += item.data.events.length;
            }
        }
    }
    return { jobIds, enqueuedEvents };
}
// ─── Queue depth probe (gateway backpressure) ───────────────────────────────
/** pg-boss v12 stores jobs in the `pgboss` schema, table `job`. */
const DEPTH_SQL = `
  SELECT name, state, COUNT(*)::int AS n
  FROM pgboss.job
  WHERE name LIKE 'ingest.%'
  GROUP BY name, state`;
/**
 * Queue depth probe. pg-boss v12 exposes no public size API, so we read the
 * job table directly — one grouped scan. Callers (gateway) cache the result
 * at ~1s granularity so the request path stays O(1).
 */
export async function ingestQueueDepth(pool) {
    const snap = { pending: 0, active: 0, failed: 0, perQueue: [] };
    try {
        const r = await pool.query(DEPTH_SQL);
        for (const row of r.rows) {
            const count = Number(row.n) || 0;
            snap.perQueue.push({ queue: row.name, state: row.state, count });
            if (row.state === 'created' || row.state === 'retry')
                snap.pending += count;
            else if (row.state === 'active')
                snap.active += count;
            else if (row.state === 'failed')
                snap.failed += count;
        }
    }
    catch (err) {
        // pg-boss schema not yet created (first boot) or transient error: report 0.
        qLogger.debug({ err }, 'queue depth probe failed; reporting zero depth');
    }
    return snap;
}
//# sourceMappingURL=ingest-queues.js.map