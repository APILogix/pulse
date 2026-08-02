import { CouponsService } from './service.js';
import { ApplyCouponSchema, ValidateCouponSchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class CouponsController {
    service;
    constructor(service) {
        this.service = service;
    }
    getOrgId(req) {
        return req.user?.currentOrgId || req.user?.orgId;
    }
    validateCoupon = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req);
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const query = ValidateCouponSchema.parse(req.query);
            const result = await this.service.validateCoupon(query.code, orgId, query.planId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    applyCoupon = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req);
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = ApplyCouponSchema.parse(req.body);
            const result = await this.service.applyCoupon(body.code, orgId, req.user.id);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map