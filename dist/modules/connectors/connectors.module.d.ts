/**
 * Notification connectors module for Fastify.
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
declare function connectorsPlugin(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
export declare const registerConnectorsModule: typeof connectorsPlugin;
export default registerConnectorsModule;
//# sourceMappingURL=connectors.module.d.ts.map