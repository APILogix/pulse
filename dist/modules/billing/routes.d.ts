/**
 * Billing routes for Fastify.
 *
 * Flow:
 * 1. Resolve organization context from authenticated user data or x-org-id.
 * 2. Delegate pricing, subscription, payment-method, invoice, usage, quota, and
 *    portal operations to BillingService.
 * 3. Convert BillingError instances into stable API responses.
 *
 * Webhook endpoints intentionally skip authenticate because payment providers
 * call them directly; provider signature validation belongs in the service.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
export declare function billingRoutes(fastify: FastifyInstance, options: FastifyPluginOptions): Promise<void>;
//# sourceMappingURL=routes.d.ts.map