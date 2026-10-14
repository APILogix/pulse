/**
 * AlertDomainOutboxRelay — relays alert lifecycle domain events (fired/resolved)
 * from the outbox into automation.
 *
 * Architecture: docs/automationv2/27-alerting-automation-event-contract.md
 *
 * Mirrors TelemetryOutboxRelay's claim/publish/mark pattern exactly (same
 * FOR UPDATE SKIP LOCKED claim shape, same markPublished/markFailed split), but
 * claims a DISJOINT row set: `signal_kind = 'alert_domain_event'` only. The two
 * relays share the underlying `telemetry_outbox` table (see the storage-quota
 * rationale in the migration comment and the event-contract doc) but never
 * compete for the same row, because TelemetryOutboxRelay's own claim filters
 * `fast_path = TRUE` and every row this relay writes has `fast_path = FALSE`.
 *
 * Publishes a pg-boss job (`automation-ingest.alert-domain-event`) that a
 * consumer registered in the AUTOMATION module picks up. This relay does not
 * import anything from src/modules/automation — the job name and payload shape
 * are the only contract between the two modules, exactly like every other
 * cross-module pg-boss handoff in this codebase.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../../lib/pgboss.js';

export const ALERT_DOMAIN_OUTBOX_JOB = 'automation-ingest.alert-domain-event';

interface AlertDomainOutboxRow {
  id: string;
  organization_id: string;
  project_id: string | null;
  attributes: {
    eventType: 'alert.event.created' | 'alert.event.resolved';
    alertKey: string;
    alertEventId: string;
    dedupeKey: string;
    payload: Record<string, unknown>;
    metadata: Record<string, unknown>;
  };
  occurred_at: Date;
  created_at: Date;
}

export interface AutomationAlertDomainEventJob {
  organizationId: string;
  projectId: string | null;
  eventType: 'alert.event.created' | 'alert.event.resolved';
  alertKey: string;
  alertEventId: string;
  dedupeKey: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export class AlertDomainOutboxRelay {
  private readonly workerId = `alert-domain-outbox-${process.pid}`;
  private readonly log: FastifyBaseLogger;

  constructor(
    private readonly db: Pool,
    logger: FastifyBaseLogger,
  ) {
    this.log = logger.child({ component: 'alert-domain-outbox-relay' });
  }

  async run(limit = 100): Promise<number> {
    const rows = await this.claim(limit);
    if (rows.length === 0) return 0;

    let published = 0;
    for (const row of rows) {
      const attrs = row.attributes;
      try {
        const job: AutomationAlertDomainEventJob = {
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
        } as never);
        await this.markPublished([row]);
        published += 1;
      } catch (err) {
        await this.markFailed([row], err instanceof Error ? err.message : String(err));
        this.log.warn({ err, row: row.id }, 'Alert domain outbox publish failed');
      }
    }
    if (published > 0) this.log.debug({ published }, 'Alert domain outbox rows published');
    return published;
  }

  private async claim(limit: number): Promise<AlertDomainOutboxRow[]> {
    const result = await this.db.query<AlertDomainOutboxRow>(
      `WITH claimed AS (
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
                  t.occurred_at, t.created_at`,
      [Math.max(1, Math.min(limit, 500)), this.workerId],
    );
    return result.rows;
  }

  private async markPublished(rows: AlertDomainOutboxRow[]): Promise<void> {
    await this.db.query(
      `UPDATE telemetry_outbox SET published_at = NOW() WHERE id = ANY($1::bigint[])`,
      [rows.map((row) => BigInt(row.id))],
    );
  }

  private async markFailed(rows: AlertDomainOutboxRow[], error: string): Promise<void> {
    await this.db.query(
      `UPDATE telemetry_outbox SET last_error = $2 WHERE id = ANY($1::bigint[])`,
      [rows.map((row) => BigInt(row.id)), error.slice(0, 4000)],
    );
  }
}
