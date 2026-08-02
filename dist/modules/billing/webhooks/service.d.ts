import { WebhooksRepository } from './repository.js';
import { BillingProvider } from '../shared/types.js';
export declare class WebhooksService {
    private readonly repository;
    constructor(repository: WebhooksRepository);
    processWebhook(provider: BillingProvider, payload: any, signature: string | undefined, secret: string | undefined, rawBody: string, requestId?: string): Promise<{
        success: boolean;
    }>;
    listWebhookEvents(options: {
        provider?: BillingProvider;
        status?: string;
        page: number;
        limit: number;
    }): Promise<{
        success: boolean;
        data: any[];
        meta: {
            page: number;
            limit: number;
            total: number;
            hasMore: boolean;
        };
    }>;
    retryWebhookEvent(eventId: string): Promise<{
        success: boolean;
        data: any;
    }>;
}
//# sourceMappingURL=service.d.ts.map