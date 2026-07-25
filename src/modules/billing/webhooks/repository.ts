import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { BillingProvider } from '../shared/types.js';

type Db = Pool | PoolClient;

export interface WebhookEventRecord {
  provider: BillingProvider;
  provider_event_id: string;
  event_type: string;
  payload: any;
  payload_sha256: string;
  signature_verified: boolean;
  api_version?: string;
  organization_id?: string | null;
  request_id?: string | null;
}

export class WebhooksRepository {
  constructor(private readonly db: Pool = pool) {}

  async insertWebhookEvent(event: WebhookEventRecord, db: Db = this.db): Promise<void> {
    await db.query(
      `INSERT INTO billing_webhook_events (
         provider, provider_event_id, event_type, organization_id, payload,
         payload_sha256, signature_verified, api_version, request_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (provider, provider_event_id) DO NOTHING`,
      [
        event.provider,
        event.provider_event_id,
        event.event_type,
        event.organization_id ?? null,
        JSON.stringify(event.payload),
        event.payload_sha256,
        event.signature_verified,
        event.api_version ?? null,
        event.request_id ?? null,
      ]
    );
  }

  async listWebhookEvents(
    options: { provider?: BillingProvider; status?: string; limit: number; offset: number },
    db: Db = this.db
  ): Promise<{ data: any[]; total: number }> {
    const values: any[] = [];
    const where: string[] = [];
    let i = 1;

    if (options.provider) {
      where.push(`provider = $${i++}`);
      values.push(options.provider);
    }
    if (options.status) {
      where.push(`processing_status = $${i++}`);
      values.push(options.status);
    }

    const whereClause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const countResult = await db.query(
      `SELECT COUNT(*)::int AS total FROM billing_webhook_events ${whereClause}`,
      values
    );

    const limitParam = i++;
    const offsetParam = i++;
    const result = await db.query(
      `SELECT
         id, provider, provider_event_id, event_type, organization_id,
         signature_verified, api_version, processing_status, retry_count,
         next_retry_at, processing_started_at, processed_at, processing_duration_ms,
         request_id, correlation_id, last_error, metadata, received_at
       FROM billing_webhook_events
       ${whereClause}
       ORDER BY received_at DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...values, options.limit, options.offset]
    );

    return { data: result.rows, total: countResult.rows[0]?.total ?? 0 };
  }

  async markWebhookEventForRetry(eventId: string, db: Db = this.db): Promise<any | null> {
    const result = await db.query(
      `UPDATE billing_webhook_events
       SET processing_status = 'received',
           next_retry_at = NOW(),
           processing_started_at = NULL,
           processed_at = NULL,
           last_error = NULL,
           metadata = metadata || jsonb_build_object('manual_retry_requested_at', NOW())
       WHERE id = $1
         AND signature_verified = TRUE
         AND processing_status IN ('failed', 'dead_letter', 'ignored')
       RETURNING
         id, provider, provider_event_id, event_type, organization_id,
         processing_status, retry_count, next_retry_at, metadata, received_at`,
      [eventId]
    );
    return result.rows[0] || null;
  }
}
