import { BillingError, BillingErrorCodes, handleBillingError } from '../shared/errors.js';
import { PaymentMethodsService } from './service.js';
import { CreatePaymentMethodSchema, ListPaymentMethodsQuerySchema, PaymentMethodParamsSchema, } from './schemas.js';
function requireOrgId(request) {
    const req = request;
    const orgId = req.user?.currentOrgId ?? req.user?.orgId;
    if (!orgId)
        throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
    return orgId;
}
export class PaymentMethodsController {
    service;
    constructor(service) {
        this.service = service;
    }
    listPaymentMethods = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const query = ListPaymentMethodsQuerySchema.parse(request.query);
            return reply.send(await this.service.listPaymentMethods(orgId, query.page, query.limit, query.includeInactive));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    createPaymentMethod = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const body = CreatePaymentMethodSchema.parse(request.body);
            return reply.code(201).send(await this.service.createPaymentMethod(orgId, body));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    setDefaultPaymentMethod = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const { paymentMethodId } = PaymentMethodParamsSchema.parse(request.params);
            return reply.send(await this.service.setDefaultPaymentMethod(orgId, paymentMethodId));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
    deactivatePaymentMethod = async (request, reply) => {
        try {
            const orgId = requireOrgId(request);
            const { paymentMethodId } = PaymentMethodParamsSchema.parse(request.params);
            return reply.send(await this.service.deactivatePaymentMethod(orgId, paymentMethodId));
        }
        catch (error) {
            return handleBillingError(error, reply);
        }
    };
}
//# sourceMappingURL=controller.js.map