import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { authenticate } from '../../../shared/middleware/auth.js';
import { PaymentsRepository } from '../payments/repository.js';
import { PaymentsService } from '../payments/service.js';
import { RefundsController } from './controller.js';

export async function refundsRoutes(
  fastify: FastifyInstance,
  _options: FastifyPluginOptions,
): Promise<void> {
  const paymentsRepository = new PaymentsRepository();
  const paymentsService = new PaymentsService(paymentsRepository);
  const controller = new RefundsController(paymentsService);

  fastify.addHook('preHandler', authenticate);
  fastify.post('/', controller.createRefund);
}
