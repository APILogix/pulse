/**
 * Alerting module for Fastify.
 *
 * Flow:
 * 1. Construct the alerting repository + service at boot.
 * 2. Decorate Fastify with the alerting service boundary.
 * 3. Register alerting routes under /organizations/:orgId/alerting.
 *
 * Background processing (batch delivery, auto-resolve) runs in the WORKER
 * process via registerAlertingWorkers() (see workers/main.ts), not here — the
 * API process stays thin and only ingests events into `pending`.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { AlertingRepository } from './repository.js';
import { AlertingService } from './service.js';
declare module 'fastify' {
    interface FastifyInstance {
        alerting: {
            repository: AlertingRepository;
            service: AlertingService;
        };
    }
}
declare function alertingModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerAlertingModule: typeof alertingModule;
export default registerAlertingModule;
//# sourceMappingURL=alerting.module.d.ts.map