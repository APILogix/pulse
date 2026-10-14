/**
 * Connector background worker entry.
 *
 * Registers connector pg-boss workers. This runs ONLY in the worker process
 * (npm run dev:workers); the API process never starts background delivery.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import './registry.js';
import { type ConnectorWorkerConfig } from './queue.js';
export type { ConnectorWorkerConfig } from './queue.js';
export declare function startConnectorMonitor(logger: FastifyBaseLogger, config?: ConnectorWorkerConfig, primaryPool?: Pool): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=workers.d.ts.map