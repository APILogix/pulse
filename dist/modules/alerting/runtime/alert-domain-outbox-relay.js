import { pgboss } from '../../../lib/pgboss.js';
export const ALERT_DOMAIN_OUTBOX_JOB = 'automation-ingest.alert-domain-event';
export class AlertDomainOutboxRelay {
    db;
    workerId = `alert-domain-outbox-${process.pid}`;
    log;
    constructor(db, logger) {
        this.db = db;
        this.log = logger.child({ component: 'alert-domain-outbox-relay' });
    }
    async run(limit = 100) {
        const rows = await this.claim(limit);
        if (rows.length === 0)
            return 0;
        let published = 0;
        for (const row of rows) {
            const attrs = row.attributes;
            try {
                const job = {
                    organizationId: row.organization_id,
                    projectId: row.project_id,
                    eventType: attrs.eventType,
                    alertKey: attrs.alertKey,
                    alertEventId: attrs.alertEventId,
                    dedupeKey: attrs.dedupeKey,
                    payload: attrs.payload,
                    metadata: attrs.metadata,
                    occurredAt: row.occurred_at.toISOString(),
                };
                await pgboss.send(ALERT_DOMAIN_OUTBOX_JOB, job, {
                    singletonKey: `alert-domain-event:${row.organization_id}:${attrs.dedupeKey}`,
                    expireInSeconds: 120,
                    retryLimit: 5,
                    retryDelay: 2,
                    retryBackoff: true,
                    // A job that exhausts retryLimit lands in pg-boss's own
                    // automation-dead-letter queue instead of silently vanishing from
                    // pg-boss's tracking. The automation-side dead-letter WORKER expects
                    // a run/workflow shape (data.orgId/runId/workflowId) and this job has
                    // neither — it will log-and-skip rather than mis-audit a fabricated
                    // "run.dead_lettered" entry, which is correct: there is no run here.
                    // The outbox row itself (still unpublished) remains the durability
                    // backstop regardless of this queue-level visibility.
                    deadLetter: 'automation-dead-letter',
                });
                await this.markPublished([row]);
                published += 1;
            }
            catch (err) {
                await this.markFailed([row], err instanceof Error ? err.message : String(err));
                this.log.warn({ err, row: row.id }, 'Alert domain outbox publish failed');
            }
        }
        if (published > 0)
            this.log.debug({ published }, 'Alert domain outbox rows published');
        return published;
    }
    async claim(limit) {
        const result = await this.db.query(`WITH claimed AS (
         SELECT id, created_at
           FROM telemetry_outbox
          WHERE signal_kind = 'alert_domain_event'
            AND published_at IS NULL
            AND (claimed_at IS NULL OR claimed_at < NOW() - INTERVAL '2 minutes')
          ORDER BY created_at ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE telemetry_outbox t
          SET claimed_at = NOW(),
              claimed_by = $2,
              attempts = attempts + 1,
              last_error = NULL
         FROM claimed
        WHERE t.id = claimed.id AND t.created_at = claimed.created_at
        RETURNING t.id::text, t.organization_id, t.project_id, t.attributes,
                  t.occurred_at, t.created_at`, [Math.max(1, Math.min(limit, 500)), this.workerId]);
        return result.rows;
    }
    async markPublished(rows) {
        await this.db.query(`UPDATE telemetry_outbox SET published_at = NOW() WHERE id = ANY($1::bigint[])`, [rows.map((row) => BigInt(row.id))]);
    }
    async markFailed(rows, error) {
        await this.db.query(`UPDATE telemetry_outbox SET last_error = $2 WHERE id = ANY($1::bigint[])`, [rows.map((row) => BigInt(row.id)), error.slice(0, 4000)]);
    }
}
//# sourceMappingURL=alert-domain-outbox-relay.js.map