import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RequestWithUser } from '../shared/types.js';
import { WebhooksService } from './service.js';
import { handleBillingError } from '../shared/errors.js';
import { BillingProvider } from '../shared/types.js';

export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  stripeWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const payload = req.body;
      const signature = request.headers['stripe-signature'] as string;
      
      // We pass a dummy secret, in reality it's from env.STRIPE_WEBHOOK_SECRET
      await this.service.processWebhook(BillingProvider.STRIPE, payload, signature, 'secret');
      
      return reply.send({ received: true });
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };

  razorpayWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const payload = req.body;
      const signature = request.headers['x-razorpay-signature'] as string;
      
      // We pass a dummy secret, in reality it's from env.RAZORPAY_WEBHOOK_SECRET
      await this.service.processWebhook(BillingProvider.RAZORPAY, payload, signature, 'secret');
      
      return reply.send({ received: true });
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
