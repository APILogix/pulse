import { pool } from '../../../config/database.js';
import type { Pool, PoolClient } from 'pg';
import { BillingProvider } from '../shared/types.js';

type Db = Pool | PoolClient;

export interface WebhookEventRecord {
  provider: BillingProvider;
  provider_event_id: string;
  event_type: string;
  payload: any;
  signature_verified: boolean;
  api_version?: string;
}

export class WebhooksRepository {
  constructor(private readonly db: Pool = pool) {}

  async insertWebhookEvent(event: WebhookEventRecord, db: Db = this.db): Promise<void> {
    await db.query(
      `INSERT INTO billing_webhook_events (
         provider, provider_event_id, event_type, payload, 
         signature_verified, api_version
       ) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (provider, provider_event_id) DO NOTHING`,
      [
        event.provider,
        event.provider_event_id,
        event.event_type,
        JSON.stringify(event.payload),
        event.signature_verified,
        event.api_version ?? null
      ]
    );
  }
}
