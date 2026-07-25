import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';

type Db = Pool | PoolClient;

export interface AiUsageLogRecord {
  organization_id: string;
  request_id?: string;
  project_id?: string;
  user_id?: string;
  feature_key: string;
  provider: string;
  model: string;
  credits_used: number;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_usd: number;
}

export class AiBillingRepository {
  constructor(private readonly db: Pool = pool) {}

  async withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async logAiUsage(record: AiUsageLogRecord, db: Db = this.db): Promise<void> {
    await db.query(
      `INSERT INTO ai_usage_logs (
         organization_id, request_id, project_id, user_id, feature_key, provider, model, 
         credits_used, prompt_tokens, completion_tokens, estimated_cost_usd
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.organization_id,
        record.request_id ?? null,
        record.project_id ?? null,
        record.user_id ?? null,
        record.feature_key,
        record.provider,
        record.model,
        record.credits_used,
        record.prompt_tokens,
        record.completion_tokens,
        record.estimated_cost_usd
      ]
    );
  }

  async lockAiRequest(orgId: string, requestId: string, db: Db = this.db): Promise<void> {
    await db.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`ai-credit:${orgId}:${requestId}`]
    );
  }

  async getAiUsageByRequestId(orgId: string, requestId: string, db: Db = this.db) {
    const result = await db.query(
      `SELECT id, credits_used, estimated_cost_usd, request_id
       FROM ai_usage_logs
       WHERE organization_id = $1 AND request_id = $2
       ORDER BY occurred_at DESC
       LIMIT 1`,
      [orgId, requestId]
    );
    return result.rows[0] ?? null;
  }

  async consumeAiCredits(orgId: string, credits: number, db: Db = this.db): Promise<void> {
    await db.query(
      `SELECT consume_ai_credits($1, $2)`,
      [orgId, credits]
    );
  }

  async hasSufficientAiCredits(orgId: string, requiredCredits: number, db: Db = this.db): Promise<boolean> {
    const result = await db.query(
      `SELECT remaining_ai_credits($1) >= $2 as has_credits`,
      [orgId, requiredCredits]
    );
    return result.rows[0]?.has_credits === true;
  }
}
