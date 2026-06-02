import { BillingRepository } from '../modules/billing/repository.js';
import { SubscriptionStatus, InvoiceStatus, UsageMetricType } from '../modules/billing/types.js';
import { addDays, addMonths, calculateInvoiceTotals, generateLineItems } from '../modules/billing/utils.js';
import { logger } from '../config/logger.js';
const billingWorkerLogger = logger.child({ component: 'billing-scheduler' });
const INVOICE_CYCLE_INTERVAL_MS = 15 * 60 * 1000;
const DUNNING_INTERVAL_MS = 60 * 60 * 1000;
const USAGE_ROLLUP_INTERVAL_MS = 60 * 60 * 1000;
const WEBHOOK_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;
let invoiceTimer = null;
let dunningTimer = null;
let usageRollupTimer = null;
let webhookTimer = null;
const jobLocks = {
    'invoice-cycle': false,
    dunning: false,
    'usage-rollup': false,
    'webhook-reconciliation': false
};
async function runJob(pool, jobName, handler) {
    if (jobLocks[jobName])
        return;
    jobLocks[jobName] = true;
    const startedAt = Date.now();
    const runKey = `${jobName}:${new Date().toISOString()}`;
    const insertResult = await pool.query(`INSERT INTO billing_job_runs (job_name, run_key, status, started_at)
     VALUES ($1, $2, 'running', NOW())
     RETURNING id`, [jobName, runKey]);
    const runId = insertResult.rows[0]?.id;
    if (!runId) {
        jobLocks[jobName] = false;
        billingWorkerLogger.error({ jobName }, 'Billing job run id was not returned');
        return;
    }
    try {
        const result = await handler();
        const durationMs = Date.now() - startedAt;
        await pool.query(`UPDATE billing_job_runs
       SET status = 'succeeded',
           finished_at = NOW(),
           duration_ms = $1,
           processed_count = $2,
           succeeded_count = $3,
           failed_count = $4,
           metadata = $5::jsonb
       WHERE id = $6`, [
            durationMs,
            result.processed,
            result.succeeded,
            result.failed,
            JSON.stringify(result.metadata ?? {}),
            runId
        ]);
    }
    catch (error) {
        const durationMs = Date.now() - startedAt;
        await pool.query(`UPDATE billing_job_runs
       SET status = 'failed',
           finished_at = NOW(),
           duration_ms = $1,
           error_summary = $2
       WHERE id = $3`, [durationMs, error instanceof Error ? error.message : 'Unknown billing job error', runId]);
        billingWorkerLogger.error({ err: error, jobName }, 'Billing job failed');
    }
    finally {
        jobLocks[jobName] = false;
    }
}
async function runInvoiceCycle(pool) {
    const repository = new BillingRepository(pool);
    const dueResult = await pool.query(`SELECT org_id, plan_id, current_period_start, current_period_end, net_terms_days, cancel_at_period_end
     FROM organization_billing
     WHERE status IN ('active', 'trialing', 'past_due')
       AND current_period_end <= NOW()`);
    let succeeded = 0;
    let failed = 0;
    for (const billing of dueResult.rows) {
        try {
            const plan = await repository.getPlanById(billing.plan_id);
            if (!plan) {
                failed += 1;
                continue;
            }
            const lineItems = generateLineItems(plan.name, plan.basePriceMonthly);
            const totals = calculateInvoiceTotals(lineItems);
            const invoiceDate = new Date();
            const dueDate = addDays(invoiceDate, Math.max(0, billing.net_terms_days ?? 0));
            await repository.createInvoice({
                orgId: billing.org_id,
                status: InvoiceStatus.OPEN,
                invoiceDate,
                dueDate,
                periodStart: billing.current_period_start,
                periodEnd: billing.current_period_end,
                subtotal: totals.subtotal,
                discountAmount: totals.discount,
                taxAmount: totals.tax,
                taxRate: 0,
                total: totals.total,
                currency: 'USD',
                lineItems
            });
            const nextPeriodStart = billing.current_period_end;
            const nextPeriodEnd = addMonths(nextPeriodStart, 1);
            await repository.updateOrganizationBilling(billing.org_id, {
                currentPeriodEnd: nextPeriodEnd,
                ...(billing.cancel_at_period_end
                    ? {
                        status: SubscriptionStatus.CANCELED,
                        canceledAt: new Date()
                    }
                    : {})
            });
            succeeded += 1;
        }
        catch {
            failed += 1;
        }
    }
    return { processed: dueResult.rowCount ?? dueResult.rows.length, succeeded, failed };
}
async function runDunning(pool) {
    const overdueResult = await pool.query(`SELECT id, org_id
     FROM organization_invoices
     WHERE status = 'open'
       AND due_date < NOW()`);
    let succeeded = 0;
    let failed = 0;
    for (const invoice of overdueResult.rows) {
        try {
            await pool.query(`UPDATE organization_billing
         SET status = $1, updated_at = NOW()
         WHERE org_id = $2 AND status <> $3`, [SubscriptionStatus.PAST_DUE, invoice.org_id, SubscriptionStatus.CANCELED]);
            succeeded += 1;
        }
        catch {
            failed += 1;
        }
    }
    return { processed: overdueResult.rowCount ?? overdueResult.rows.length, succeeded, failed };
}
async function runUsageRollup(pool) {
    const counters = await pool.query(`SELECT org_id, api_requests_this_period, metrics_ingested_this_period, storage_gb_this_period, notifications_sent_this_period
     FROM organization_usage_counters`);
    let succeeded = 0;
    let failed = 0;
    const now = new Date();
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dayEnd = addDays(dayStart, 1);
    for (const counter of counters.rows) {
        const snapshots = [
            { type: UsageMetricType.API_REQUESTS, name: 'API Requests', value: Number(counter.api_requests_this_period) },
            { type: UsageMetricType.METRICS_INGESTED, name: 'Metrics Ingested', value: Number(counter.metrics_ingested_this_period) },
            { type: UsageMetricType.STORAGE_GB, name: 'Storage (GB)', value: Number(counter.storage_gb_this_period) },
            { type: UsageMetricType.ALERT_NOTIFICATIONS, name: 'Alert Notifications', value: Number(counter.notifications_sent_this_period) }
        ];
        for (const snapshot of snapshots) {
            try {
                await pool.query(`INSERT INTO organization_usage (
            org_id, metric_type, metric_name, period_start, period_end, granularity, usage_count, details
           ) VALUES ($1, $2, $3, $4, $5, 'daily', $6, '{}'::jsonb)
           ON CONFLICT (org_id, metric_type, metric_name, period_start, granularity)
           DO UPDATE SET usage_count = EXCLUDED.usage_count, updated_at = NOW()`, [counter.org_id, snapshot.type, snapshot.name, dayStart, dayEnd, snapshot.value]);
                succeeded += 1;
            }
            catch {
                failed += 1;
            }
        }
    }
    const counterCount = counters.rowCount ?? counters.rows.length;
    return { processed: counterCount * 4, succeeded, failed };
}
async function runWebhookReconciliation(pool) {
    const staleEvents = await pool.query(`SELECT id, retry_count
     FROM billing_webhook_events
     WHERE processing_status IN ('pending', 'failed')
       AND retry_count < 10
       AND COALESCE(processed_at, received_at) < NOW() - INTERVAL '5 minutes'
     ORDER BY received_at ASC
     LIMIT 200`);
    let succeeded = 0;
    let failed = 0;
    for (const event of staleEvents.rows) {
        try {
            await pool.query(`UPDATE billing_webhook_events
         SET processing_status = 'failed',
             retry_count = $1,
             processed_at = NOW(),
             processing_error = 'Reconciliation pass marked for retry',
             updated_at = NOW()
         WHERE id = $2`, [event.retry_count + 1, event.id]);
            succeeded += 1;
        }
        catch {
            failed += 1;
        }
    }
    return { processed: staleEvents.rowCount ?? staleEvents.rows.length, succeeded, failed };
}
export function startBillingWorker(pool) {
    if (invoiceTimer || dunningTimer || usageRollupTimer || webhookTimer)
        return;
    billingWorkerLogger.info('Starting billing scheduler');
    void runJob(pool, 'invoice-cycle', () => runInvoiceCycle(pool));
    void runJob(pool, 'dunning', () => runDunning(pool));
    void runJob(pool, 'usage-rollup', () => runUsageRollup(pool));
    void runJob(pool, 'webhook-reconciliation', () => runWebhookReconciliation(pool));
    invoiceTimer = setInterval(() => void runJob(pool, 'invoice-cycle', () => runInvoiceCycle(pool)), INVOICE_CYCLE_INTERVAL_MS);
    dunningTimer = setInterval(() => void runJob(pool, 'dunning', () => runDunning(pool)), DUNNING_INTERVAL_MS);
    usageRollupTimer = setInterval(() => void runJob(pool, 'usage-rollup', () => runUsageRollup(pool)), USAGE_ROLLUP_INTERVAL_MS);
    webhookTimer = setInterval(() => void runJob(pool, 'webhook-reconciliation', () => runWebhookReconciliation(pool)), WEBHOOK_RECONCILIATION_INTERVAL_MS);
    invoiceTimer.unref();
    dunningTimer.unref();
    usageRollupTimer.unref();
    webhookTimer.unref();
}
export function stopBillingWorker() {
    if (invoiceTimer)
        clearInterval(invoiceTimer);
    if (dunningTimer)
        clearInterval(dunningTimer);
    if (usageRollupTimer)
        clearInterval(usageRollupTimer);
    if (webhookTimer)
        clearInterval(webhookTimer);
    invoiceTimer = null;
    dunningTimer = null;
    usageRollupTimer = null;
    webhookTimer = null;
}
//# sourceMappingURL=billing.processor.js.map