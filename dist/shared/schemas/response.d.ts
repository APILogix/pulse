/**
 * Shared response schemas for Fastify serialization optimization.
 *
 * Using Fastify-native JSON schemas enables compiled serialization,
 * which reduces GC pressure and improves throughput by 10-30%.
 */
import type { FastifySchema } from 'fastify';
export declare const ApiResponseSchema: FastifySchema;
export declare const PaginatedResponseSchema: FastifySchema;
export declare const HealthResponseSchema: FastifySchema;
//# sourceMappingURL=response.d.ts.map