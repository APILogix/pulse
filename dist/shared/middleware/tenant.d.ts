/**
 * Tenant-isolation middleware.
 *
 * Provides preHandlers that enforce multi-tenant boundaries for resources
 * addressed by `:projectId` (and optionally `:orgId`) in the route path.
 *
 * Why this exists:
 *   Project-scoped read modules (analytics, ingestion management) take a
 *   `projectId` straight from the URL. Without a membership check, ANY
 *   authenticated user could read ANY tenant's telemetry by guessing/leaking a
 *   project UUID (cross-tenant IDOR). This guard resolves the project to its
 *   owning organization and verifies the caller is an ACTIVE member of that
 *   organization before the handler runs.
 *
 * Scalability:
 *   The (projectId -> orgId) mapping and the (orgId, userId) membership
 *   decision are cached in short-TTL in-process LRUs (no Redis), so the hot
 *   analytics/read path does not hit Postgres on every request. Caches are
 *   keyed so a membership revocation is reflected within the TTL window
 *   (default 30s) without a deploy.
 *
 * Authorization model:
 *   Membership-only (any active member of the owning org may read the project).
 *   Role-level gating is intentionally deferred and can be layered on here
 *   later in one place.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
export declare function requireProjectMembership(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/** Use when projectId is supplied via query string (ingestion read APIs). */
export declare function requireProjectMembershipFromQuery(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/** Use when projectId is in the JSON body (e.g. replay). */
export declare function requireProjectMembershipFromBody(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/**
 * Require the authenticated caller to be an active member of `:orgId`.
 * Use as a preHandler AFTER `authenticate`.
 */
export declare function requireOrgMembership(request: FastifyRequest, reply: FastifyReply): Promise<void>;
/**
 * Invalidate cached membership for a user in an org. Call this from the org
 * service when a member is removed/suspended/role-changed so the read guards
 * reflect the change immediately rather than after the TTL.
 */
export declare function invalidateMembershipCache(orgId: string, userId: string): void;
/** Invalidate the cached project->org mapping (e.g. on project delete). */
export declare function invalidateProjectOrgCache(projectId: string): void;
//# sourceMappingURL=tenant.d.ts.map