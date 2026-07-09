import { SubscriptionsService } from './service.js';
import { CreateSubscriptionSchema, ChangePlanSchema, CancelSubscriptionSchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class SubscriptionsController {
    service;
    constructor(service) {
        this.service = service;
    }
    getSubscription = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const result = await this.service.getSubscription(orgId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getHistory = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const result = await this.service.getHistory(orgId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    createSubscription = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = CreateSubscriptionSchema.parse(req.body);
            if (!body.billingInterval) {
                throw new BillingError('Billing interval is required', BillingErrorCodes.INTERNAL_ERROR, 400);
            }
            const result = await this.service.createSubscription(orgId, body.planId, body.billingInterval, req.user.id);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    changePlan = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = ChangePlanSchema.parse(req.body);
            const result = await this.service.changePlan(orgId, body.planId, req.user.id);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    cancelSubscription = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const _body = CancelSubscriptionSchema.parse(req.body);
            const result = await this.service.cancelSubscription(orgId, req.user.id);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map