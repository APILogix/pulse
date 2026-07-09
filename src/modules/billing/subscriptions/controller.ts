import type { FastifyRequest, FastifyReply } from 'fastify';
import { SubscriptionsService } from './service.js';
import { 
  CreateSubscriptionSchema, 
  ChangePlanSchema, 
  CancelSubscriptionSchema,
  type CreateSubscriptionBody,
  type ChangePlanBody,
  type CancelSubscriptionBody
} from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  getSubscription = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const result = await this.service.getSubscription(orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getHistory = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const result = await this.service.getHistory(orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  createSubscription = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const body = CreateSubscriptionSchema.parse(req.body) as CreateSubscriptionBody;
      if (!body.billingInterval) {
        throw new BillingError('Billing interval is required', BillingErrorCodes.INTERNAL_ERROR, 400);
      }
      
      const result = await this.service.createSubscription(orgId, body.planId, body.billingInterval, req.user!.id);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  changePlan = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const body = ChangePlanSchema.parse(req.body) as ChangePlanBody;
      const result = await this.service.changePlan(orgId, body.planId, req.user!.id);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  cancelSubscription = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const _body = CancelSubscriptionSchema.parse(req.body) as CancelSubscriptionBody;
      const result = await this.service.cancelSubscription(orgId, req.user!.id);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
