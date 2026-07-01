/**
 * Prometheus metrics plugin for Fastify.
 *
 * Exposes RED metrics (Rate, Errors, Duration) and USE metrics
 * (Utilization, Saturation, Errors) at /metrics endpoint.
 */
import type { FastifyInstance } from 'fastify';
import promClient from 'prom-client';
declare const register: promClient.Registry<"text/plain; version=0.0.4; charset=utf-8">;
declare const httpRequestDurationMicroseconds: promClient.Histogram<"method" | "status_code" | "route">;
declare const httpRequestTotal: promClient.Counter<"method" | "status_code" | "route">;
declare const httpRequestsInFlight: promClient.Gauge<string>;
declare function metricsPlugin(fastify: FastifyInstance): Promise<void>;
export declare const registerMetricsPlugin: typeof metricsPlugin;
export { register, httpRequestDurationMicroseconds, httpRequestTotal, httpRequestsInFlight };
//# sourceMappingURL=metrics.d.ts.map