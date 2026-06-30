/**
 * Connector background worker entry.
 *
 * Constructs the connector repository/dispatcher/service and starts the
 * ConnectorMonitor (delivery retry sweeps + health heartbeats). This runs ONLY
 * in the worker process (npm run dev:workers); the API process never starts it.
 */
import type { FastifyBaseLogger } from 'fastify';
import './registry.js';
export declare function startConnectorMonitor(logger: FastifyBaseLogger): {
    stop: () => Promise<void>;
};
//# sourceMappingURL=workers.d.ts.map