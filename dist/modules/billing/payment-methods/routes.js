import { authenticate } from '../../../shared/middleware/auth.js';
import { PaymentMethodsController } from './controller.js';
import { PaymentMethodsRepository } from './repository.js';
import { PaymentMethodsService } from './service.js';
export async function paymentMethodsRoutes(fastify, _options) {
    const repository = new PaymentMethodsRepository();
    const service = new PaymentMethodsService(repository);
    const controller = new PaymentMethodsController(service);
    fastify.addHook('preHandler', authenticate);
    fastify.get('/', controller.listPaymentMethods);
    fastify.post('/', controller.createPaymentMethod);
    fastify.post('/:paymentMethodId/default', controller.setDefaultPaymentMethod);
    fastify.delete('/:paymentMethodId', controller.deactivatePaymentMethod);
}
//# sourceMappingURL=routes.js.map