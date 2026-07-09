import { CouponsService } from './service.js';
import { ApplyCouponSchema, ValidateCouponSchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class CouponsController {
    service;
    constructor(service) {
        this.service = service;
    }
    validateCoupon = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
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
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = ApplyCouponSchema.parse(req.body);
            // We assume planId is known from the context of what they are applying it to, 
            // but if not provided, the service would need to look up their current cart/plan.
            // For this API, let's assume they just apply it to their current active plan/subscription.
            // In a real system, the cart/checkout session carries the planId. 
            // We'll pass a dummy planId here to fulfill the typing since this is a decoupled slice.
            const dummyPlanId = "00000000-0000-0000-0000-000000000000";
            const result = await this.service.applyCoupon(body.code, orgId, dummyPlanId, req.user.id);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map