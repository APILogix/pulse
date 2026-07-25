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
}
