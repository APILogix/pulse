import type { FastifyRequest, FastifyReply } from 'fastify';
import { SubscriptionsService } from './service.js';
import { 
  CreateSubscriptionSchema, 
  ChangePlanSchema, 
  CancelSubscriptionSchema,
  PreviewChangeSchema,
  ScheduledChangeSchema,
  type CreateSubscriptionBody,
  type ChangePlanBody,
  type CancelSubscriptionBody,
  type PreviewChangeBody,
  type ScheduledChangeBody
} from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class SubscriptionsController {
  constructor(private readonly service: SubscriptionsService) {}

  private getOrgId(req: RequestWithUser): string | undefined {
    return req.user?.currentOrgId || req.user?.orgId;
  }

  getSubscription = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req);
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
      const orgId = this.getOrgId(req);
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
      const orgId = this.getOrgId(req);
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
      const orgId = this.getOrgId(req);
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
      const orgId = this.getOrgId(req);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const _body = CancelSubscriptionSchema.parse(req.body) as CancelSubscriptionBody;
      const result = await this.service.cancelSubscription(orgId, req.user!.id);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  previewChange = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const body = PreviewChangeSchema.parse(req.body) as PreviewChangeBody;
      const result = await this.service.previewChange(orgId, body.newPlanId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  scheduledChange = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const body = ScheduledChangeSchema.parse(req.body) as ScheduledChangeBody;
      const result = await this.service.scheduleChange(
        orgId,
        body.planId,
        req.user!.id,
        body.effectiveAt,
        body.prorationBehavior,
      );
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getSummary = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = this.getOrgId(req);
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const result = await this.service.getSummary(orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
