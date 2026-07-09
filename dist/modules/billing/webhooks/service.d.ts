import { WebhooksRepository } from './repository.js';
import { BillingProvider } from '../shared/types.js';
export declare class WebhooksService {
    private readonly repository;
    constructor(repository: WebhooksRepository);
    processWebhook(provider: BillingProvider, payload: any, signature: string, secret: string): Promise<{
        success: boolean;
    }>;
}
//# sourceMappingURL=service.d.ts.map