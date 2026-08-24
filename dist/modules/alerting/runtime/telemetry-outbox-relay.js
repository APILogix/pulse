import { pgboss } from '../../../lib/pgboss.js';
export class TelemetryOutboxRelay {
    db;
    workerId = `alert-outbox-${process.pid}`;
    log;
    constructor(db, logger) {
        this.db = db;
        this.log = logger.child({ component: 'telemetry-outbox-relay' });
    }
    async run(limit = 250) {
        const rows = await this.claim(limit);
        if (rows.length === 0)
            return 0;
        const semantic = rows.filter((row) => row.signal_kind === 'error_group_regressed');
        const telemetry = rows.filter((row) => row.signal_kind !== 'error_group_regressed');
        let published = 0;
        for (const row of semantic) {
            try {
                await pgboss.send('alert.error-group-regressed', row.attributes, {
                    singletonKey: `error-group-regressed:${row.organization_id}:${row.event_id}`,
                    expireInSeconds: 120,
                    retryLimit: 3,
                    retryDelay: 1,
                    retryBackoff: true,
                });
                await this.markPublished([row]);
                published += 1;
            }
            catch (err) {
                await this.markFailed([row], err instanceof Error ? err.message : String(err));
                this.log.warn({ err, row: row.id }, 'Error-group regression outbox publish failed');
            }
        }
        const groups = new Map();
        for (const row of telemetry) {
            const key = JSON.stringify([row.organization_id, row.project_id, row.environment]);
            const list = groups.get(key) ?? [];
            list.push(row);
            groups.set(key, list);
        }
        for (const group of groups.values()) {
            const first = group[0];
            try {
                await pgboss.send('alert.evaluate.fast', {
                    organizationId: first.organization_id,
                    projectId: first.project_id,
                    environment: first.environment,
                    events: group.map(outboxToScopedEvent),
                }, {
                    singletonKey: `telemetry-outbox:${first.organization_id}:${first.project_id}:${group.map((row) => row.id).join('-')}`,
                    expireInSeconds: 120,
                    retryLimit: 3,
                    retryDelay: 1,
                    retryBackoff: true,
                });
                await this.markPublished(group);
                published += group.length;
            }
            catch (err) {
                await this.markFailed(group, err instanceof Error ? err.message : String(err));
                this.log.warn({ err, rows: group.length }, 'Telemetry outbox relay publish failed');
            }
        }
        if (published > 0)
            this.log.debug({ published }, 'Telemetry outbox rows published');
        return published;
    }
    async claim(limit) {
        const result = await this.db.query(`WITH claimed AS (
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
                  t.occurred_at, t.created_at`, [Math.max(1, Math.min(limit, 1000)), this.workerId]);
        return result.rows;
    }
    async markPublished(rows) {
        await this.db.query(`UPDATE telemetry_outbox
          SET published_at = NOW()
        WHERE id = ANY($1::bigint[])`, [rows.map((row) => BigInt(row.id))]);
    }
    async markFailed(rows, error) {
        await this.db.query(`UPDATE telemetry_outbox
          SET last_error = $2
        WHERE id = ANY($1::bigint[])`, [rows.map((row) => BigInt(row.id)), error.slice(0, 4000)]);
    }
}
function outboxToScopedEvent(row) {
    const attrs = typeof row.attributes === 'object' && row.attributes !== null ? row.attributes : {};
    const event = {
        type: row.signal_kind,
        eventId: row.event_id,
        timestamp: row.occurred_at.getTime(),
        severity: row.severity ?? undefined,
        status: row.signal_kind === 'cron_checkin' ? 'error' : undefined,
        message: attrs.message ?? '',
        ...attrs,
    };
    return {
        projectId: row.project_id,
        projectSlug: typeof attrs.projectSlug === 'string' ? attrs.projectSlug : undefined,
        projectName: typeof attrs.projectName === 'string' ? attrs.projectName : undefined,
        orgId: row.organization_id,
        orgSlug: typeof attrs.orgSlug === 'string' ? attrs.orgSlug : undefined,
        orgName: typeof attrs.orgName === 'string' ? attrs.orgName : undefined,
        environment: row.environment ?? 'production',
        event,
    };
}
//# sourceMappingURL=telemetry-outbox-relay.js.map