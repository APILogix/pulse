/**
 * Notification connectors module for Fastify.
 *
 * Flow:
 * 1. Construct repository, dispatcher, service, and the background monitor.
 * 2. Decorate Fastify with the connector service boundary.
 * 3. Register connector routes under /organizations/:orgId/connectors.
 *
 * The background monitor (retry + health sweeps) is NOT started here — it runs
 * only in the worker process (npm run dev:workers) via startConnectorMonitor()
 * in workers/main.ts. The API process (npm run dev) serves HTTP only and runs
 * no background job workers.
 *
 * The connector type registry self-registers built-in connectors on import.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { ConnectorService } from './service.js';
import { ConnectorMonitor } from './monitor.js';
import './registry.js';
declare module 'fastify' {
    interface FastifyInstance {
        connectors: {
            repository: ConnectorRepository;
            dispatcher: NotificationDispatcher;
            service: ConnectorService;
            monitor: ConnectorMonitor;
        };
    }
}
declare function connectorsModule(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerConnectorsModule: typeof connectorsModule;
export default registerConnectorsModule;
//# sourceMappingURL=connectors.module.d.ts.map