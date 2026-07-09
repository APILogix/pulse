import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export interface CurrentUsageRow {
  organization_id: string;
  period_start: Date;
  period_end: Date;
  events_used: number;
  event_limit: number;
  remaining_events: number;
  ai_credits_used: number;
  ai_credit_limit: number;
  remaining_ai_credits: number;
  projects_used: number;
  members_used: number;
  api_keys_used: number;
  connectors_used: number;
  alert_rules_used: number;
  dashboards_used: number;
}

export class UsageRepository {
  constructor(private readonly db: Pool = pool) {}

  async getCurrentUsage(orgId: string, db: Db = this.db): Promise<CurrentUsageRow | null> {
    const result = await db.query(
      `SELECT * FROM v_current_usage WHERE organization_id = $1`,
      [orgId]
    );
    return result.rows[0] || null;
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
}
