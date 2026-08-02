import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { PaymentMethodsRepository } from './repository.js';
export class PaymentMethodsService {
    repository;
    constructor(repository) {
        this.repository = repository;
    }
    async listPaymentMethods(orgId, page = 1, limit = 20, includeInactive = false) {
        const offset = (page - 1) * limit;
        const { data, total } = await this.repository.listPaymentMethods(orgId, { includeInactive, limit, offset });
        return { success: true, data, meta: { page, limit, total, hasMore: offset + data.length < total } };
    }
    async createPaymentMethod(orgId, body) {
        return this.repository.withTransaction(async (client) => ({
            success: true,
            data: await this.repository.createPaymentMethod(orgId, body, client),
        }));
    }
    async setDefaultPaymentMethod(orgId, paymentMethodId) {
        return this.repository.withTransaction(async (client) => {
            const row = await this.repository.setDefault(orgId, paymentMethodId, client);
            if (!row) {
                throw new BillingError('Payment method not found', BillingErrorCodes.PAYMENT_METHOD_NOT_FOUND, 404);
            }
            return { success: true, data: row };
        });
    }
    async deactivatePaymentMethod(orgId, paymentMethodId) {
        const row = await this.repository.deactivate(orgId, paymentMethodId);
        if (!row) {
            throw new BillingError('Payment method not found', BillingErrorCodes.PAYMENT_METHOD_NOT_FOUND, 404);
        }
        return { success: true, data: row };
    }
}
//# sourceMappingURL=service.js.map