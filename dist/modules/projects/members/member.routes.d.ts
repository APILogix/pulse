/**
 * Project member, invitation, and custom role route registration.
 *
 * Flow:
 * 1. Authenticate every endpoint.
 * 2. Parse params/query/body with module schemas before calling the service.
 * 3. Pass an audit-friendly RequestMeta into mutating calls so org audit logs
 *    capture actor, ip, user agent, request id, method, and endpoint.
 * 4. Normalize service errors through handleProjectError.
 *
 * Prefix: /organizations/:orgId/projects
 */
import type { FastifyInstance } from "fastify";
export declare function projectMemberRoutes(fastify: FastifyInstance): Promise<void>;
//# sourceMappingURL=member.routes.d.ts.map