import type { FastifyRequest, FastifyReply } from 'fastify';
import { UsageService } from './service.js';
import {
  GetUsageRecordsSchema,
  type GetUsageRecordsQuery,
  IncrementUsageSchema,
  type IncrementUsageBody,
  UsageAttributionQuerySchema,
  type UsageAttributionQuery,
} from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';

export class UsageController {
  constructor(private readonly service: UsageService) { }

  getCurrentUsage = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user?.currentOrgId || req.user?.orgId;
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
      const orgId = req.user?.currentOrgId || req.user?.orgId;
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
      const orgId = req.user?.currentOrgId || req.user?.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const body = IncrementUsageSchema.parse(req.body) as IncrementUsageBody;
      const result = await this.service.incrementEventUsage(orgId, body.count);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getProjectAttribution = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user?.currentOrgId || req.user?.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const query = UsageAttributionQuerySchema.parse(req.query) as UsageAttributionQuery;
      const options: Parameters<UsageService['getProjectAttribution']>[1] = {
        bucket: query.bucket,
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      };
      if (query.startDate) options.startDate = new Date(query.startDate);
      if (query.endDate) options.endDate = new Date(query.endDate);
      if (query.projectId) options.projectId = query.projectId;

      const result = await this.service.getProjectAttribution(orgId, options);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  getApiKeyAttribution = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user?.currentOrgId || req.user?.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const query = UsageAttributionQuerySchema.parse(req.query) as UsageAttributionQuery;
      const options: Parameters<UsageService['getApiKeyAttribution']>[1] = {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      };
      if (query.startDate) options.startDate = new Date(query.startDate);
      if (query.endDate) options.endDate = new Date(query.endDate);
      if (query.projectId) options.projectId = query.projectId;

      const result = await this.service.getApiKeyAttribution(orgId, options);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
