import type { FastifyRequest, FastifyReply } from 'fastify';
import { CouponsService } from './service.js';
import { 
  ApplyCouponSchema, 
  ValidateCouponSchema,
  type ApplyCouponBody,
  type ValidateCouponQuery
} from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class CouponsController {
  constructor(private readonly service: CouponsService) {}

  private getOrgId(req: RequestWithUser): string | undefined {
    return req.user?.currentOrgId || req.user?.orgId;
  }

  validateCoupon = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const query = ValidateCouponSchema.parse(req.query) as ValidateCouponQuery;
      const result = await this.service.validateCoupon(query.code, orgId, query.planId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  applyCoupon = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const body = ApplyCouponSchema.parse(req.body) as ApplyCouponBody;
      
      const result = await this.service.applyCoupon(body.code, orgId, req.user!.id);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
