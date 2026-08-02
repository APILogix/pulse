import { SubscriptionsService } from './service.js';
import { CreateSubscriptionSchema, ChangePlanSchema, CancelSubscriptionSchema, PreviewChangeSchema, ScheduledChangeSchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class SubscriptionsController {
    service;
    constructor(service) {
        this.service = service;
    }
    getOrgId(req) {
        return req.user?.currentOrgId || req.user?.orgId;
    }
    getSubscription = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req);
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
            const orgId = this.getOrgId(req);
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
            const orgId = this.getOrgId(req);
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
            const orgId = this.getOrgId(req);
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
            const orgId = this.getOrgId(req);
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
    previewChange = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req);
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = PreviewChangeSchema.parse(req.body);
            const result = await this.service.previewChange(orgId, body.newPlanId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    scheduledChange = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req);
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = ScheduledChangeSchema.parse(req.body);
            const result = await this.service.scheduleChange(orgId, body.planId, req.user.id, body.effectiveAt, body.prorationBehavior);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    getSummary = async (request, reply) => {
        const req = request;
        try {
            const orgId = this.getOrgId(req);
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const result = await this.service.getSummary(orgId);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map