import { LRUCache } from "lru-cache";
import { pool } from "../../config/database.js";
// projectId -> orgId. 60s TTL: project ownership effectively never changes.
// A sentinel ("") marks "project does not exist" so we can negatively cache
// without violating the LRU value-type constraint (which disallows null).
const NO_ORG = "";
const projectOrgCache = new LRUCache({
    max: 50_000,
    ttl: 60 * 1000,
    ttlAutopurge: true,
});
// `${orgId}:${userId}` -> isActiveMember. 30s TTL bounds how long a removed
// member can keep reading after revocation.
const membershipCache = new LRUCache({
    max: 100_000,
    ttl: 30 * 1000,
    ttlAutopurge: true,
});
function unauthorized(reply, code, message, status = 403) {
    return reply.status(status).send({ error: { code, message } });
}
function getParam(request, ...names) {
    const params = (request.params ?? {});
    for (const name of names) {
        const value = params[name];
        if (typeof value === "string" && value.length > 0)
            return value;
    }
    return null;
}
async function resolveProjectOrg(projectId) {
    const cached = projectOrgCache.get(projectId);
    if (cached !== undefined)
        return cached === NO_ORG ? null : cached;
    const result = await pool.query(`SELECT org_id FROM projects WHERE id = $1 AND deleted_at IS NULL LIMIT 1`, [projectId]);
    const orgId = result.rows[0]?.org_id ?? null;
    projectOrgCache.set(projectId, orgId ?? NO_ORG);
    return orgId;
}
async function isActiveMember(orgId, userId) {
    const cacheKey = `${orgId}:${userId}`;
    const cached = membershipCache.get(cacheKey);
    if (cached !== undefined)
        return cached;
    const result = await pool.query(`SELECT TRUE AS ok
     FROM organization_members
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'
     LIMIT 1`, [orgId, userId]);
    const ok = result.rows.length > 0;
    membershipCache.set(cacheKey, ok);
    return ok;
}
/**
 * Require the authenticated caller to be an active member of the organization
 * that owns the `:projectId` in the route. Use as a preHandler AFTER
 * `authenticate`.
 */
export async function requireProjectMembership(request, reply) {
    const userId = request.user?.id;
    const projectId = getParam(request, "projectId", "project_id");
    if (!userId) {
        return void unauthorized(reply, "UNAUTHORIZED", "Authentication required", 401);
    }
    if (!projectId) {
        return void unauthorized(reply, "VALIDATION_ERROR", "Project context is required", 400);
    }
    const orgId = await resolveProjectOrg(projectId);
    if (!orgId) {
        // Do not distinguish "not found" from "forbidden" to avoid leaking which
        // project UUIDs exist across tenants.
        return void unauthorized(reply, "PROJECT_NOT_FOUND", "Project not found", 404);
    }
    if (!(await isActiveMember(orgId, userId))) {
        return void unauthorized(reply, "INSUFFICIENT_PERMISSIONS", "You do not have access to this project", 403);
    }
}
/**
 * Require the authenticated caller to be an active member of `:orgId`.
 * Use as a preHandler AFTER `authenticate`.
 */
export async function requireOrgMembership(request, reply) {
    const userId = request.user?.id;
    const orgId = getParam(request, "orgId", "org_id");
    if (!userId) {
        return void unauthorized(reply, "UNAUTHORIZED", "Authentication required", 401);
    }
    if (!orgId) {
        return void unauthorized(reply, "VALIDATION_ERROR", "Organization context is required", 400);
    }
    if (!(await isActiveMember(orgId, userId))) {
        return void unauthorized(reply, "INSUFFICIENT_PERMISSIONS", "You do not have access to this organization", 403);
    }
}
/**
 * Invalidate cached membership for a user in an org. Call this from the org
 * service when a member is removed/suspended/role-changed so the read guards
 * reflect the change immediately rather than after the TTL.
 */
export function invalidateMembershipCache(orgId, userId) {
    membershipCache.delete(`${orgId}:${userId}`);
}
/** Invalidate the cached project->org mapping (e.g. on project delete). */
export function invalidateProjectOrgCache(projectId) {
    projectOrgCache.delete(projectId);
}
//# sourceMappingURL=tenant.js.map