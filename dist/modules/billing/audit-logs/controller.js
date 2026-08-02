import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
import { BillingAuditLogsService } from './service.js';
import { ListBillingAuditLogsQuerySchema } from './schemas.js';
export class BillingAuditLogsController {
    service;
    constructor(service) {
        this.service = service;
    }
    listAuditLogs = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user?.currentOrgId || req.user?.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const query = ListBillingAuditLogsQuerySchema.parse(req.query);
            const filters = {
                limit: query.limit,
                offset: (query.page - 1) * query.limit,
            };
            if (query.action)
                filters.action = query.action;
            if (query.subscriptionId)
                filters.subscriptionId = query.subscriptionId;
            if (query.invoiceId)
                filters.invoiceId = query.invoiceId;
            if (query.paymentId)
                filters.paymentId = query.paymentId;
            if (query.startDate)
                filters.startDate = new Date(query.startDate);
            if (query.endDate)
                filters.endDate = new Date(query.endDate);
            const result = await this.service.listAuditLogs(orgId, filters);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map