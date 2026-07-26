import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
import { PaymentsService } from '../payments/service.js';
import { CreateRefundSchema } from './schemas.js';
export class RefundsController {
    paymentsService;
    constructor(paymentsService) {
        this.paymentsService = paymentsService;
    }
    createRefund = async (request, reply) => {
        const req = request;
        try {
            const orgId = req.user?.currentOrgId || req.user?.orgId;
            if (!orgId)
                throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
            const body = CreateRefundSchema.parse(request.body);
            const result = await this.paymentsService.refundPayment(orgId, body.paymentId, body.amount, body.reason);
            return reply.code(201).send(result);
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map