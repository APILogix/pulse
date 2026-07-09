import { AiBillingRepository } from './repository.js';
export declare class AiBillingService {
    private readonly repository;
    constructor(repository: AiBillingRepository);
    consumeAiCredits(orgId: string, userId: string, featureKey: string, provider: string, model: string, promptTokens: number, completionTokens: number, projectId?: string): Promise<{
        success: boolean;
        data: {
            creditsUsed: number;
            estimatedCostUsd: number;
        };
    }>;
}
//# sourceMappingURL=service.d.ts.map