/**
 * Observability Explorer module.
 *
 * Wires the Unified Explorer Query Engine, correlation engine, AI investigator,
 * and context resolver into a single org-scoped router mounted at
 * `/organizations/:orgId/observability`. Telemetry reads hit the dedicated Log
 * DB; identity/permissions come from the primary DB. Redis-free.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ObservabilityService } from './service.js';
import { ObservabilityController } from './controller.js';
declare module 'fastify' {
    interface FastifyInstance {
        observability: {
            service: ObservabilityService;
            controller: ObservabilityController;
        };
    }
}
declare function observabilityModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerObservabilityModule: typeof observabilityModule;
export default registerObservabilityModule;
//# sourceMappingURL=observability.module.d.ts.map