/**
 * /analytics/v2 read API.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md
 *
 * Scoping deviates slightly from the document (recorded in DEVIATIONS.md D10):
 * routes are nested under `/org/:orgId` or `/projects/:projectId` so the existing
 * `requireOrgMembership` / `requireProjectMembership` guards apply unchanged,
 * rather than inventing a new org-resolution path.
 *
 * Every handler follows the same shape:
 *   parse scope → read rollups (current + previous window) → format → envelope.
 * No handler aggregates raw telemetry.
 */
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { WindowSize } from '../types.js';
export declare function analyticsV2Routes(fastify: FastifyInstance, _options: FastifyPluginOptions): Promise<void>;
/** Exposed for the contract test so route registration can be asserted. */
export { ANALYTICS_V2_SCOPED_ROUTES, ANALYTICS_V2_GLOBAL_ROUTES, analyticsV2Paths, } from './route-manifest.js';
export type { WindowSize };
//# sourceMappingURL=analytics-v2.routes.d.ts.map