import type { FastifyInstance } from 'fastify';
/**
 * Health & Readiness Plugin
 *
 * Exposes Kubernetes-standard probe endpoints:
 * - /health  — shallow liveness (process is running)
 * - /live    — alias for liveness (always 200 if process is up)
 * - /ready   — deep readiness (checks DB, Redis, Log DB)
 * - /metrics — Prometheus metrics (registered via metrics plugin)
 *
 * Wrapped in fastify-plugin so these routes are available at the root scope.
 */
declare function healthPlugin(fastify: FastifyInstance): Promise<void>;
export declare const registerHealthPlugin: typeof healthPlugin;
export {};
//# sourceMappingURL=plugins.d.ts.map