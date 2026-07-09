import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { InvoicesController } from './controller.js';
import { InvoicesService } from './service.js';
import { InvoicesRepository } from './repository.js';
import { authenticate } from '../../../shared/middleware/auth.js';

export async function invoicesRoutes(
  fastify: FastifyInstance,
  options: FastifyPluginOptions
): Promise<void> {
  const repository = new InvoicesRepository();
  const service = new InvoicesService(repository);
  const controller = new InvoicesController(service);

  fastify.addHook('preHandler', authenticate);

  fastify.get('/', controller.listInvoices);
  fastify.get('/upcoming', controller.getUpcomingInvoice);
  fastify.get('/:invoiceId', controller.getInvoice);
  fastify.post('/:invoiceId/pay', controller.payInvoice);
}
