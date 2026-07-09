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
export declare class WebhooksRepository {
    private readonly db;
    constructor(db?: Pool);
    insertWebhookEvent(event: WebhookEventRecord, db?: Db): Promise<void>;
}
export {};
//# sourceMappingURL=repository.d.ts.map