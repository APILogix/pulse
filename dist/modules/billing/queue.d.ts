/**
 * Billing PGMQ queue wiring.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { BillingJobConfig } from './jobs/types.js';
export declare function billingQueueName(name: string): string;
export declare function registerBillingJobWorkers(logger: FastifyBaseLogger, config?: BillingJobConfig): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map