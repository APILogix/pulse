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
export declare class WebhooksRepository {
    private readonly db;
    constructor(db?: Pool);
    insertWebhookEvent(event: WebhookEventRecord, db?: Db): Promise<void>;
    listWebhookEvents(options: {
        provider?: BillingProvider;
        status?: string;
        limit: number;
        offset: number;
    }, db?: Db): Promise<{
        data: any[];
        total: number;
    }>;
    markWebhookEventForRetry(eventId: string, db?: Db): Promise<any | null>;
}
export {};
//# sourceMappingURL=repository.d.ts.map