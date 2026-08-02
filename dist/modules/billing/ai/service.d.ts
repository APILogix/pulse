import { AiBillingRepository } from './repository.js';
export declare class AiBillingService {
    private readonly repository;
    constructor(repository: AiBillingRepository);
    consumeAiCredits(orgId: string, userId: string, requestId: string | undefined, featureKey: string, provider: string, model: string, promptTokens: number, completionTokens: number, projectId?: string): Promise<{
        success: boolean;
        data: {
            creditsUsed: number;
            estimatedCostUsd: number;
            idempotent: boolean;
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map