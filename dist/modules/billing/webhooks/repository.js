import { pool } from '../../../config/database.js';
import { BillingProvider } from '../shared/types.js';
export class WebhooksRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async insertWebhookEvent(event, db = this.db) {
        await db.query(`INSERT INTO billing_webhook_events (
         provider, provider_event_id, event_type, organization_id, payload,
         payload_sha256, signature_verified, api_version, request_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (provider, provider_event_id) DO NOTHING`, [
            event.provider,
            event.provider_event_id,
            event.event_type,
            event.organization_id ?? null,
            JSON.stringify(event.payload),
            event.payload_sha256,
            event.signature_verified,
            event.api_version ?? null,
            event.request_id ?? null,
        ]);
    }
}
//# sourceMappingURL=repository.js.map