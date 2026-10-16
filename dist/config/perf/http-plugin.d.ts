/**
 * Fastify Performance Monitoring Plugin.
 *
 * Implements:
 * 1. AsyncLocalStorage context propagation from incoming HTTP requests.
 * 2. Response Server-Timing header injection (dev, staging, or sampled admin requests).
 * 3. Structured per-request JSON logging with database & cache durations and query counts.
 * 4. Internal diagnostic endpoint: GET /admin/perf/latency-summary.
 * 5. Startup validation of query latency budgets.
 */
import type { FastifyInstance } from 'fastify';
import { type RequestPerfStats } from './context.js';
declare module 'fastify' {
    interface FastifyRequest {
        perfStats?: RequestPerfStats;
        startTimePerf?: number;
    }
}
/**
 * Registers performance hooks, metrics pollers, and admin diagnostic routes.
 */
export declare function registerPerfPlugin(app: FastifyInstance): Promise<void>;
//# sourceMappingURL=http-plugin.d.ts.map