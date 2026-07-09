import { AiBillingRepository } from './repository.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
// Rough dummy estimates for cost, in a real system this would be fetched from pricing config
const PRICING = {
    'gpt-4': { per1kPrompt: 0.03, per1kCompletion: 0.06 },
    'gpt-3.5-turbo': { per1kPrompt: 0.0015, per1kCompletion: 0.002 },
};
export class AiBillingService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async consumeAiCredits(orgId, userId, featureKey, provider, model, promptTokens, completionTokens, projectId) {
        // 1. Calculate cost / credits
        const pricing = PRICING[model] || PRICING['gpt-3.5-turbo'];
        const estimatedCostUsd = ((promptTokens / 1000) * pricing.per1kPrompt) +
            ((completionTokens / 1000) * pricing.per1kCompletion);
        // E.g., 1 credit = $0.001 (1000 credits = $1)
        const creditsUsed = Math.max(1, Math.ceil(estimatedCostUsd * 1000));
        // 2. Check if enough credits
        const hasCredits = await this.repository.hasSufficientAiCredits(orgId, creditsUsed);
        if (!hasCredits) {
            throw new BillingError('Insufficient AI credits', BillingErrorCodes.INSUFFICIENT_CREDITS, 402, { required: creditsUsed });
        }
        // 3. Deduct credits & Log usage
        await this.repository.withTransaction(async (client) => {
            // Deduct
            await this.repository.consumeAiCredits(orgId, creditsUsed, client);
            // Log
            await this.repository.logAiUsage({
                organization_id: orgId,
                ...(projectId ? { project_id: projectId } : {}),
                ...(userId ? { user_id: userId } : {}),
                feature_key: featureKey,
                provider,
                model,
                credits_used: creditsUsed,
                prompt_tokens: promptTokens,
                completion_tokens: completionTokens,
                estimated_cost_usd: estimatedCostUsd
            }, client);
        });
        return {
            success: true,
            data: {
                creditsUsed,
                estimatedCostUsd
            }
        };
    }
}
//# sourceMappingURL=service.js.map