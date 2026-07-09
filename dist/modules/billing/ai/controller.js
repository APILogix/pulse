import { AiBillingService } from './service.js';
import { ConsumeAiCreditsSchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class AiBillingController {
    service;
    constructor(service) {
        this.service = service;
    }
    consumeAiCredits = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = ConsumeAiCreditsSchema.parse(req.body);
            const result = await this.service.consumeAiCredits(orgId, req.user.id, body.featureKey, body.provider, body.model, body.promptTokens, body.completionTokens, body.projectId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map