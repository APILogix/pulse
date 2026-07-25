import { WebhooksRepository } from './repository.js';
import { BillingProvider } from '../shared/types.js';
export declare class WebhooksService {
    private readonly repository;
    constructor(repository: WebhooksRepository);
    processWebhook(provider: BillingProvider, payload: any, signature: string | undefined, secret: string | undefined, rawBody: string, requestId?: string): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=service.d.ts.map