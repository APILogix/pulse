/**
 * Benchmark routes — public, no-auth endpoints.
 *
 * GET /benchmark          → lightweight liveness + runtime info
 * GET /benchmark/heavy    → synchronous CPU-bound workload
 * GET /benchmark/async    → concurrent async workload via Promise.all
 */
import type { FastifyInstance } from 'fastify';
declare function benchmarkPlugin(fastify: FastifyInstance): Promise<void>;
export declare const registerBenchmarkRoutes: typeof benchmarkPlugin;
export {};
//# sourceMappingURL=routes.d.ts.map