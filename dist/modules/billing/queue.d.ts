/**
 * Billing pg-boss queue wiring.
 *
 * Schedules are stored in Postgres and delivered to one worker, so the billing
 * jobs are safe across horizontally scaled worker and cron processes.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { BillingJobConfig } from './jobs/types.js';
export declare function registerBillingJobWorkers(logger: FastifyBaseLogger, config?: BillingJobConfig): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map