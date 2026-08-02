/**
 * Billing module for Fastify (Redesigned Vertical Slice Architecture).
 *
 * Flow:
 * 1. Register encapsulated slice routes (Plans, Subscriptions, Entitlements, Usage, etc.)
 * 2. Prefix them with /billing
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
declare function billingModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerBillingModule: typeof billingModule;
export default registerBillingModule;
//# sourceMappingURL=billing.module.d.ts.map