import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { pgboss } from '../../../lib/pgboss.js';
import type { ScopedEvent } from '../../ingestion/pipeline/telemetry-writer.js';
import type { NormalizedEvent } from '../../ingestion/pipeline/event-normalizer.js';

interface TelemetryOutboxRow {
  id: string;
  organization_id: string;
  project_id: string;
  environment: string | null;
  signal_kind: string;
  event_id: string;
  severity: string | null;
  attributes: Record<string, unknown>;
  occurred_at: Date;
  created_at: Date;
}

export class TelemetryOutboxRelay {
  private readonly workerId = `alert-outbox-${process.pid}`;
  private readonly log: FastifyBaseLogger;

  constructor(
    private readonly db: Pool,
    logger: FastifyBaseLogger,
  ) {
    this.log = logger.child({ component: 'telemetry-outbox-relay' });
  }

  async run(limit = 250): Promise<number> {
    const rows = await this.claim(limit);
    if (rows.length === 0) return 0;
    const groups = new Map<string, TelemetryOutboxRow[]>();
    for (const row of rows) {
      const key = JSON.stringify([row.organization_id, row.project_id, row.environment]);
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }

    let published = 0;
    for (const group of groups.values()) {
      const first = group[0]!;
      try {
        await pgboss.send(
          'alert.evaluate.fast',
          {
            organizationId: first.organization_id,
            projectId: first.project_id,
            environment: first.environment,
            events: group.map(outboxToScopedEvent),
          },
          {
            singletonKey: `telemetry-outbox:${first.organization_id}:${first.project_id}:${group.map((row) => row.id).join('-')}`,
            expireInSeconds: 120,
            retryLimit: 3,
            retryDelay: 1,
            retryBackoff: true,
          } as never,
        );
        await this.markPublished(group);
        published += group.length;
      } catch (err) {
        await this.markFailed(group, err instanceof Error ? err.message : String(err));
        this.log.warn({ err, rows: group.length }, 'Telemetry outbox relay publish failed');
      }
    }
    if (published > 0) this.log.debug({ published }, 'Telemetry outbox rows published');
    return published;
  }

  private async claim(limit: number): Promise<TelemetryOutboxRow[]> {
    const result = await this.db.query<TelemetryOutboxRow>(
      `WITH claimed AS (
         SELECT id, created_at
           FROM telemetry_outbox
          WHERE published_at IS NULL
            AND fast_path = TRUE
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
        RETURNING t.id::text, t.organization_id, t.project_id, t.environment,
                  t.signal_kind, t.event_id, t.severity, t.attributes,
                  t.occurred_at, t.created_at`,
      [Math.max(1, Math.min(limit, 1000)), this.workerId],
    );
    return result.rows;
  }

  private async markPublished(rows: TelemetryOutboxRow[]): Promise<void> {
    await this.db.query(
      `UPDATE telemetry_outbox
          SET published_at = NOW()
        WHERE id = ANY($1::bigint[])`,
      [rows.map((row) => BigInt(row.id))],
    );
  }

  private async markFailed(rows: TelemetryOutboxRow[], error: string): Promise<void> {
    await this.db.query(
      `UPDATE telemetry_outbox
          SET last_error = $2
        WHERE id = ANY($1::bigint[])`,
      [rows.map((row) => BigInt(row.id)), error.slice(0, 4000)],
    );
  }
}

function outboxToScopedEvent(row: TelemetryOutboxRow): ScopedEvent {
  const event = {
    type: row.signal_kind,
    eventId: row.event_id,
    timestamp: row.occurred_at.getTime(),
    severity: row.severity ?? undefined,
    status: row.signal_kind === 'cron_checkin' ? 'error' : undefined,
    message: row.attributes?.message ?? '',
  } as unknown as NormalizedEvent;
  return {
    projectId: row.project_id,
    orgId: row.organization_id,
    environment: row.environment ?? 'production',
    event,
  };
}
