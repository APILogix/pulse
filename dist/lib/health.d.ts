import type { FastifyInstance } from 'fastify';
import type { BackpressureGauge } from './gauge.js';
interface HealthConfig {
    gauge: BackpressureGauge;
    maxQueueDepth: number;
    maxGaugeAgeMs: number;
    customReadyCheck?: () => Promise<{
        healthy: boolean;
        reason?: string;
    }>;
}
/**
 * Load-balancer health checks.
 *
 * /health/live is a liveness signal. /health/ready is the Oracle Cloud Load
 * Balancer traffic gate and fails closed when the shared gauge is stale or deep.
 */
export declare function registerHealthChecks(app: FastifyInstance, config: HealthConfig): Promise<void>;
export {};
//# sourceMappingURL=health.d.ts.map