import type { FastifyRequest, FastifyReply } from 'fastify';
import { EntitlementsService } from './service.js';
import { CheckFeatureAccessSchema, type CheckFeatureAccessBody } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class EntitlementsController {
  constructor(private readonly service: EntitlementsService) {}

  private getOrgId(req: RequestWithUser, request: FastifyRequest): string | undefined {
    const header = request.headers['x-org-id'] || request.headers['X-Org-Id'];
    const headerOrgId = Array.isArray(header) ? header[0] : header;
    return headerOrgId || req.user?.currentOrgId || req.user?.orgId;
  }

  getAllEntitlements = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req, request);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const result = await this.service.getAllEntitlements(orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  checkFeatureAccess = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req, request);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const body = CheckFeatureAccessSchema.parse(req.body) as CheckFeatureAccessBody;
      const result = await this.service.checkFeatureAccess(orgId, body.featureKey, body.quantity ?? 1);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
