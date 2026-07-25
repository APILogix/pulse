import type { FastifyReply, FastifyRequest } from 'fastify';
import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
import type { RequestWithUser } from '../shared/types.js';
import { BillingAuditLogsService } from './service.js';
import { ListBillingAuditLogsQuerySchema, type ListBillingAuditLogsQuery } from './schemas.js';
import type { BillingAuditLogFilters } from './repository.js';

export class BillingAuditLogsController {
  constructor(private readonly service: BillingAuditLogsService) {}

  listAuditLogs = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const orgId = req.user?.currentOrgId || req.user?.orgId;
      if (!orgId) throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);

      const query = ListBillingAuditLogsQuerySchema.parse(req.query) as ListBillingAuditLogsQuery;
      const filters: BillingAuditLogFilters = {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      };
      if (query.action) filters.action = query.action;
      if (query.subscriptionId) filters.subscriptionId = query.subscriptionId;
      if (query.invoiceId) filters.invoiceId = query.invoiceId;
      if (query.paymentId) filters.paymentId = query.paymentId;
      if (query.startDate) filters.startDate = new Date(query.startDate);
      if (query.endDate) filters.endDate = new Date(query.endDate);

      const result = await this.service.listAuditLogs(orgId, filters);
      return reply.send(result);
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
