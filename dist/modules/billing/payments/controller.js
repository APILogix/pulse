import { PaymentsService } from './service.js';
import { ListPaymentsQuerySchema } from './schemas.js';
import { handleBillingError, BillingError, BillingErrorCodes } from '../shared/errors.js';
export class PaymentsController {
    service;
    constructor(service) {
        this.service = service;
    }
    listPayments = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const query = ListPaymentsQuerySchema.parse(req.query);
            const result = await this.service.listPayments(orgId, query.page, query.limit, query.status);
            return reply.send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map