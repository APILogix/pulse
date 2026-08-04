/**
 * Observability routes. Everything is org-scoped under
 * `/organizations/:orgId/observability` and passes `authenticate` +
 * `requireOrgAccess` (Phase 18). Static sub-paths (summary/statistics/
 * timeline/facets/stream) are declared before `/:id` so Fastify's radix router
 * resolves them ahead of the parametric detail route.
 */
import type { FastifyInstance } from 'fastify';
import type { ObservabilityController } from './controller.js';
export declare function buildObservabilityRoutes(controller: ObservabilityController): (fastify: FastifyInstance) => Promise<void>;
//# sourceMappingURL=routes.d.ts.map