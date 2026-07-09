import type { FastifyRequest, FastifyReply } from 'fastify';
import { UsageService } from './service.js';
import { GetUsageRecordsSchema, type GetUsageRecordsQuery, IncrementUsageSchema, type IncrementUsageBody } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class UsageController {
  constructor(private readonly service: UsageService) {}

  getCurrentUsage = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const result = await this.service.getCurrentUsage(orgId);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getDailyUsage = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const query = GetUsageRecordsSchema.parse(req.query) as GetUsageRecordsQuery;
      const startDate = query.startDate ? new Date(query.startDate) : undefined;
      const endDate = query.endDate ? new Date(query.endDate) : undefined;

      const result = await this.service.getDailyUsage(orgId, startDate, endDate);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  incrementEventUsage = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user!.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
      
      const body = IncrementUsageSchema.parse(req.body) as IncrementUsageBody;
      const result = await this.service.incrementEventUsage(orgId, body.count);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
