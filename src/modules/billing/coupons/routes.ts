import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { CouponsController } from './controller.js';
import { CouponsService } from './service.js';
import { CouponsRepository } from './repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function couponsRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new CouponsRepository();
  const service = new CouponsService(repository);
  const controller = new CouponsController(service);

  fastify.addHook('preHandler', authenticate);

  fastify.get('/validate', controller.validateCoupon);
  fastify.post('/apply', controller.applyCoupon);
}
