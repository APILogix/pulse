/**
 * Project route registration (management API only — NO ingestion routes).
 *
 * Flow:
 * 1. Authenticate every project/API-key/environment management endpoint.
 * 2. Parse params/query/body with module schemas before calling the service.
 * 3. Pass an audit-friendly RequestMeta into mutating calls so org audit logs
 *    capture actor, ip, user agent, request id, method, and endpoint.
 * 4. Normalize service errors through handleProjectError.
 *
 * Prefix: /organizations/:orgId/projects
 */
import type { FastifyInstance } from "fastify";
export declare function projectApiKeyRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=api-key.routes.d.ts.map