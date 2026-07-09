import type { FastifyRequest, FastifyReply } from 'fastify';
import { AiBillingService } from './service.js';
import { ConsumeAiCreditsSchema, type ConsumeAiCreditsBody } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class AiBillingController {
  constructor(private readonly service: AiBillingService) {}

  consumeAiCredits = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const body = ConsumeAiCreditsSchema.parse(req.body) as ConsumeAiCreditsBody;
      
      const result = await this.service.consumeAiCredits(
        orgId,
        req.user!.id,
        body.featureKey,
        body.provider,
        body.model,
        body.promptTokens,
        body.completionTokens,
        body.projectId
      );
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
