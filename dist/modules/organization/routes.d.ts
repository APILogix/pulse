/**
 * Organization route registration.
 *
 * All routes use:
 * - Zod validation on params/query/body
 * - RequestMeta for audit trail
 * - Standardized success/error responses
 * - withErrorHandling for consistent error mapping
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
export declare function organizationRoutes(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
//# sourceMappingURL=routes.d.ts.map