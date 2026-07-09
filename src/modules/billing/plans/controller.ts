import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RequestWithUser } from '../shared/types.js';
import { PlansService } from './service.js';
import { EstimatePricingSchema, PlanIdParamsSchema, type EstimatePricingBody } from './schemas.js';
import { handleBillingError } from '../shared/errors.js';

export class PlansController {
  constructor(private readonly service: PlansService) {}

  listPlans = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const result = await this.service.listPlans(true);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  listPublicPlans = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const result = await this.service.listPlans(false);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getPlan = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const { planId } = PlanIdParamsSchema.parse(req.params);
      const result = await this.service.getPlan(planId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  comparePlans = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      // In a full implementation this would call a specific compare method on the service
      // For now, listing public plans gives all the features needed for frontend comparison
      const result = await this.service.listPlans(false);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  estimatePricing = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const body = EstimatePricingSchema.parse(req.body) as EstimatePricingBody;
      const result = await this.service.estimatePricing(body.planId, body.interval, body.couponCode);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
