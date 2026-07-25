import type { FastifyRequest, FastifyReply } from 'fastify';
import type { RequestWithUser } from '../shared/types.js';
import { WebhooksService } from './service.js';
import { handleBillingError } from '../shared/errors.js';
import { BillingProvider } from '../shared/types.js';

function rawBodyOf(request: FastifyRequest): string {
  const rawBody = (request as any).rawBody;
  if (typeof rawBody === 'string') return rawBody;
  if (Buffer.isBuffer(rawBody)) return rawBody.toString('utf8');
  return JSON.stringify(request.body ?? {});
}

export class WebhooksController {
  constructor(private readonly service: WebhooksService) {}

  stripeWebhook = async (request: FastifyRequest, reply: FastifyReply) => {
    const req = request as RequestWithUser;
    try {
      const payload = req.body;
      const signature = request.headers['stripe-signature'] as string;

      await this.service.processWebhook(
        BillingProvider.STRIPE,
        payload,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET,
        rawBodyOf(request),
        request.id,
      );
      
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

      await this.service.processWebhook(
        BillingProvider.RAZORPAY,
        payload,
        signature,
        process.env.RAZORPAY_WEBHOOK_SECRET,
        rawBodyOf(request),
        request.id,
      );
      
      return reply.send({ received: true });
    } catch (error) {
      return handleBillingError(error, reply);
    }
  };
}
