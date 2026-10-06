import { pool } from '../../../config/database.js';
const PROJECT_USAGE_TABLES = {
    minute: 'project_usage_minute',
    hour: 'project_usage_hourly',
    day: 'project_usage_daily',
};
export const CURRENT_USAGE_COLUMNS = `
  organization_id, period_start, period_end, events_used, event_limit, remaining_events,
  ai_credits_used, ai_credit_limit, remaining_ai_credits, projects_used, members_used,
  api_keys_used, connectors_used, alert_rules_used, dashboards_used
`;
export const USAGE_DAILY_COUNTER_COLUMNS = `
  id, organization_id, project_id, usage_date, events_count, ai_credits_used,
  requests_count, errors_count, traces_count, spans_count, metrics_count,
  logs_count, profiles_count, replays_count, alert_notifications_count,
  connector_sends_count, email_sends_count, slack_sends_count, sms_sends_count,
  webhook_sends_count, created_at, updated_at
`;
export class UsageRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async getCurrentUsage(orgId, db = this.db) {
        const result = await db.query(`SELECT ${CURRENT_USAGE_COLUMNS} FROM v_current_usage WHERE organization_id = $1`, [orgId]);
        return result.rows[0] || null;
    }
    async isActiveOrganizationMember(orgId, userId, db = this.db) {
        const result = await db.query(`SELECT EXISTS (
         SELECT 1
         FROM organization_members
         WHERE org_id = $1
           AND user_id = $2
           AND status = 'active'
       ) AS is_member`, [orgId, userId]);
        return result.rows[0]?.is_member === true;
    }
    async incrementEventUsage(orgId, count = 1, db = this.db, rawCount) {
        if (rawCount !== undefined) {
            await db.query(`SELECT increment_event_usage($1, $2, $3)`, [orgId, count, rawCount]);
        }
        else {
            await db.query(`SELECT increment_event_usage($1, $2)`, [orgId, count]);
        }
    }
    async getDailyUsageRecords(orgId, startDate, endDate, limit = 365, db = this.db) {
        const values = [orgId];
        let i = 2;
        const where = ['organization_id = $1'];
        if (startDate) {
            where.push(`usage_date >= $${i++}`);
            values.push(startDate);
        }
        if (endDate) {
            where.push(`usage_date <= $${i++}`);
            values.push(endDate);
        }
        values.push(limit);
        const result = await db.query(`SELECT ${USAGE_DAILY_COUNTER_COLUMNS} FROM usage_daily_counters WHERE ${where.join(' AND ')} ORDER BY usage_date DESC LIMIT $${i}`, values);
        return result.rows;
    }
    async getProjectAttribution(orgId, options, db = this.db) {
        const values = [orgId];
        let i = 2;
        const where = ['organization_id = $1'];
        if (options.startDate) {
            where.push(`bucket >= $${i++}`);
            values.push(options.startDate);
        }
        if (options.endDate) {
            where.push(`bucket <= $${i++}`);
            values.push(options.endDate);
        }
        if (options.projectId) {
            where.push(`project_id = $${i++}`);
            values.push(options.projectId);
        }
        const table = PROJECT_USAGE_TABLES[options.bucket];
        const limitParam = i++;
        const offsetParam = i++;
        values.push(options.limit, options.offset);
        const result = await db.query(`SELECT
         project_id,
         MIN(bucket) AS first_bucket,
         MAX(bucket) AS last_bucket,
         SUM(total_events)::bigint AS total_events,
         SUM(errors)::bigint AS errors,
         SUM(requests)::bigint AS requests,
         SUM(transactions)::bigint AS transactions,
         SUM(traces)::bigint AS traces,
         SUM(spans)::bigint AS spans,
         SUM(logs)::bigint AS logs,
         SUM(metrics)::bigint AS metrics,
         SUM(profiles)::bigint AS profiles,
         SUM(ai_events)::bigint AS ai_events,
         SUM(rate_limit_usage)::bigint AS rate_limit_usage
       FROM ${table}
       WHERE ${where.join(' AND ')}
       GROUP BY project_id
       ORDER BY total_events DESC, project_id
       LIMIT $${limitParam} OFFSET $${offsetParam}`, values);
        return result.rows;
    }
    async getApiKeyAttribution(orgId, options, db = this.db) {
        const values = [orgId];
        let i = 2;
        const where = ['u.organization_id = $1'];
        if (options.startDate) {
            where.push(`u.bucket >= $${i++}`);
            values.push(options.startDate);
        }
        if (options.endDate) {
            where.push(`u.bucket <= $${i++}`);
            values.push(options.endDate);
        }
        if (options.projectId) {
            where.push(`u.project_id = $${i++}`);
            values.push(options.projectId);
        }
        const limitParam = i++;
        const offsetParam = i++;
        values.push(options.limit, options.offset);
        const result = await db.query(
        // Billing attribution reads the daily physical fact: it is the retained
        // billing grain (25 months) and is not bounded by minute retention.
        `SELECT
         u.api_key_id,
         u.project_id,
         u.environment_id,
         k.name AS api_key_name,
         k.public_key,
         k.status AS api_key_status,
         MIN(u.bucket) AS first_bucket,
         MAX(u.bucket) AS last_bucket,
         SUM(u.request_count)::bigint AS requests,
         SUM(u.accepted_event_count)::bigint AS events,
         SUM(u.error_event_count)::bigint AS errors,
         SUM(u.ingestion_failure_count)::bigint AS ingestion_failures,
         SUM(u.accepted_bytes)::bigint AS accepted_bytes,
         SUM(u.rate_limited_request_count)::bigint AS rate_limited
       FROM api_key_usage_daily u
       JOIN project_api_keys k ON k.id = u.api_key_id
       WHERE ${where.join(' AND ')}
       GROUP BY u.api_key_id, u.project_id, u.environment_id,
                k.name, k.public_key, k.status
       ORDER BY events DESC, requests DESC, u.api_key_id
       LIMIT $${limitParam} OFFSET $${offsetParam}`, values);
        return result.rows;
    }
}
//# sourceMappingURL=repository.js.map