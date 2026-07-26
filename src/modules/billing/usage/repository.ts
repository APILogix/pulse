import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export interface CurrentUsageRow {
  organization_id: string;
  period_start: Date;
  period_end: Date;
  events_used: number | string;
  event_limit: number | string;
  remaining_events: number | string;
  ai_credits_used: number | string;
  ai_credit_limit: number | string;
  remaining_ai_credits: number | string;
  projects_used: number | string;
  members_used: number | string;
  api_keys_used: number | string;
  connectors_used: number | string;
  alert_rules_used: number | string;
  dashboards_used: number | string;
}

type UsageBucket = 'minute' | 'hour' | 'day';

const PROJECT_USAGE_TABLES: Record<UsageBucket, string> = {
  minute: 'project_usage_minute',
  hour: 'project_usage_hourly',
  day: 'project_usage_daily',
};

export class UsageRepository {
  constructor(private readonly db: Pool = pool) {}

  async getCurrentUsage(orgId: string, db: Db = this.db): Promise<CurrentUsageRow | null> {
    const result = await db.query(
      `SELECT * FROM v_current_usage WHERE organization_id = $1`,
      [orgId]
    );
    return result.rows[0] || null;
  }

  async isActiveOrganizationMember(orgId: string, userId: string, db: Db = this.db): Promise<boolean> {
    const result = await db.query<{ is_member: boolean }>(
      `SELECT EXISTS (
         SELECT 1
         FROM organization_members
         WHERE org_id = $1
           AND user_id = $2
           AND status = 'active'
       ) AS is_member`,
      [orgId, userId],
    );
    return result.rows[0]?.is_member === true;
  }

  async incrementEventUsage(orgId: string, count: number = 1, db: Db = this.db): Promise<void> {
    await db.query(
      `SELECT increment_event_usage($1, $2)`,
      [orgId, count]
    );
  }

  async getDailyUsageRecords(orgId: string, startDate?: Date, endDate?: Date, db: Db = this.db) {
    const values: any[] = [orgId];
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

    const result = await db.query(
      `SELECT * FROM usage_daily_counters WHERE ${where.join(' AND ')} ORDER BY usage_date DESC`,
      values
    );
    return result.rows;
  }

  async getProjectAttribution(
    orgId: string,
    options: { bucket: UsageBucket; startDate?: Date; endDate?: Date; projectId?: string; limit: number; offset: number },
    db: Db = this.db
  ) {
    const values: any[] = [orgId];
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

    const result = await db.query(
      `SELECT
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
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values
    );
    return result.rows;
  }

  async getApiKeyAttribution(
    orgId: string,
    options: { startDate?: Date; endDate?: Date; projectId?: string; limit: number; offset: number },
    db: Db = this.db
  ) {
    const values: any[] = [orgId];
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

    const limitParam = i++;
    const offsetParam = i++;
    values.push(options.limit, options.offset);

    const result = await db.query(
      `SELECT
         api_key_id,
         project_id,
         environment_id,
         MIN(bucket) AS first_bucket,
         MAX(bucket) AS last_bucket,
         SUM(requests)::bigint AS requests,
         SUM(events)::bigint AS events,
         SUM(errors)::bigint AS errors,
         SUM(rate_limited)::bigint AS rate_limited
       FROM api_key_usage_minute
       WHERE ${where.join(' AND ')}
       GROUP BY api_key_id, project_id, environment_id
       ORDER BY events DESC, requests DESC, api_key_id
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      values
    );
    return result.rows;
  }
}
