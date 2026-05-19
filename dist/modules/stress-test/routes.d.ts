/**
 * Stress test route — heavy CPU computation endpoint.
 *
 * Simulates real-world CPU-bound workloads:
 * - Cryptographic hashing iterations
 * - Large array sorting
 * - Fibonacci computation
 * - Matrix multiplication
 * - Prime number generation
 *
 * This route is intentionally blocking to measure event loop degradation
 * under concurrent load.
 */
import type { FastifyInstance } from 'fastify';
export declare function registerStressTestRoute(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=routes.d.ts.map