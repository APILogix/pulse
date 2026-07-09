import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { PaymentsController } from './controller.js';
import { PaymentsService } from './service.js';
import { PaymentsRepository } from './repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function paymentsRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new PaymentsRepository();
  const service = new PaymentsService(repository);
  const controller = new PaymentsController(service);

  fastify.addHook('preHandler', authenticate);

  // We map the legacy /payment-methods to /payments conceptually here,
  // but for exact legacy contract compatibility we might mount this at /payment-methods
  // For the new clean slice architecture, we keep it as payments route logic.
  fastify.get('/', controller.listPayments);
}
