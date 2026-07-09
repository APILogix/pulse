import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { WebhooksController } from './controller.js';
import { WebhooksService } from './service.js';
import { WebhooksRepository } from './repository.js';

export async function webhooksRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new WebhooksRepository();
  const service = new WebhooksService(repository);
  const controller = new WebhooksController(service);

  // Note: These routes are public. Auth happens inside the controller via signature verification.
  fastify.post('/stripe', controller.stripeWebhook);
  fastify.post('/razorpay', controller.razorpayWebhook);
}
