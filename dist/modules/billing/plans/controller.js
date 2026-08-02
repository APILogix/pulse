import { PlansService } from './service.js';
import { EstimatePricingSchema, PlanIdParamsSchema } from './schemas.js';
import { handleBillingError } from '../shared/errors.js';
export class PlansController {
    service;
    constructor(service) {
        this.service = service;
    }
    listPlans = async (request, reply) => {
        const req = request;
        try {
            const result = await this.service.listPlans(true);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    listPublicPlans = async (request, reply) => {
        const req = request;
        try {
            const result = await this.service.listPlans(false);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getPlan = async (request, reply) => {
        const req = request;
        try {
            const { planId } = PlanIdParamsSchema.parse(req.params);
            const result = await this.service.getPlan(planId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    comparePlans = async (request, reply) => {
        const req = request;
        try {
            // In a full implementation this would call a specific compare method on the service
            // For now, listing public plans gives all the features needed for frontend comparison
            const result = await this.service.listPlans(false);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    estimatePricing = async (request, reply) => {
        const req = request;
        try {
            const body = EstimatePricingSchema.parse(req.body);
            const result = await this.service.estimatePricing(body.planId, body.interval, body.couponCode);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map