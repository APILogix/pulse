import { LRUCache } from "lru-cache";
import { pool } from "../../config/database.js";
import { registerL1Cache, publishInvalidation } from "../cache/invalidation-bus.js";
import { recordCacheRequest } from "../../config/perf/metrics.js";
// projectId -> orgId. 60s TTL: project ownership effectively never changes.
// A sentinel ("") marks "project does not exist" so we can negatively cache
// without violating the LRU value-type constraint (which disallows null).
const NO_ORG = "";
export const projectOrgCache = new LRUCache({
    max: 50_000,
    ttl: 60 * 1000,
    ttlAutopurge: true,
});
// `${orgId}:${userId}` -> isActiveMember. 30s TTL bounds how long a removed
// member can keep reading after revocation.
export const membershipCache = new LRUCache({
    max: 100_000,
    ttl: 30 * 1000,
    ttlAutopurge: true,
});
// `${projectId}:${userId}` -> role. 60s TTL bounds staleness of project role checks.
export const projectRoleCache = new LRUCache({
    max: 100_000,
    ttl: 60 * 1000,
    ttlAutopurge: true,
});
registerL1Cache("membership", membershipCache);
registerL1Cache("projectOrg", projectOrgCache);
registerL1Cache("projectRole", projectRoleCache);
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
function getQueryParam(request, ...names) {
    const query = (request.query ?? {});
    for (const name of names) {
        const value = query[name];
        if (typeof value === "string" && value.length > 0)
            return value;
    }
    return null;
}
function getBodyProjectId(request) {
    const body = request.body;
    if (!body || typeof body !== "object")
        return null;
    const projectId = body.projectId;
    return typeof projectId === "string" && projectId.length > 0 ? projectId : null;
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
async function assertProjectMembership(request, reply, projectId) {
    const userId = request.user?.id;
    if (!userId) {
        unauthorized(reply, "UNAUTHORIZED", "Authentication required", 401);
        return false;
    }
    if (!projectId) {
        unauthorized(reply, "VALIDATION_ERROR", "Project context is required", 400);
        return false;
    }
    const orgId = await resolveProjectOrg(projectId);
    if (!orgId) {
        unauthorized(reply, "PROJECT_NOT_FOUND", "Project not found", 404);
        return false;
    }
    if (!(await isActiveMember(orgId, userId))) {
        unauthorized(reply, "INSUFFICIENT_PERMISSIONS", "You do not have access to this project", 403);
        return false;
    }
    return true;
}
export async function requireProjectMembership(request, reply) {
    const projectId = getParam(request, "projectId", "project_id");
    if (!(await assertProjectMembership(request, reply, projectId)))
        return;
}
/** Use when projectId is supplied via query string (ingestion read APIs). */
export async function requireProjectMembershipFromQuery(request, reply) {
    const projectId = getQueryParam(request, "projectId", "project_id");
    if (!(await assertProjectMembership(request, reply, projectId)))
        return;
}
/** Use when projectId is in the JSON body (e.g. replay). */
export async function requireProjectMembershipFromBody(request, reply) {
    const projectId = getBodyProjectId(request);
    if (!(await assertProjectMembership(request, reply, projectId)))
        return;
}
/**
 * Require the authenticated caller to be an active member of `:orgId`.
 * Use as a preHandler AFTER `authenticate`.
 */
export async function requireOrgMembership(request, reply) {
    const userId = request.user?.id;
    const orgId = getParam(request, "orgId", "org_id");
    if (!userId) {
        return unauthorized(reply, "UNAUTHORIZED", "Authentication required", 401);
    }
    if (!orgId) {
        return unauthorized(reply, "VALIDATION_ERROR", "Organization context is required", 400);
    }
    if (!(await isActiveMember(orgId, userId))) {
        return unauthorized(reply, "INSUFFICIENT_PERMISSIONS", "You do not have access to this organization", 403);
    }
}
/**
 * Invalidate cached membership for a user in an org. Call this from the org
 * service when a member is removed/suspended/role-changed so the read guards
 * reflect the change immediately rather than after the TTL.
 */
export function invalidateMembershipCache(orgId, userId) {
    const key = `${orgId}:${userId}`;
    membershipCache.delete(key);
    void publishInvalidation("membership", key);
}
/** Invalidate the cached project->org mapping (e.g. on project delete). */
export function invalidateProjectOrgCache(projectId) {
    projectOrgCache.delete(projectId);
    void publishInvalidation("projectOrg", projectId);
}
const NO_ROLE = "__NONE__";
/**
 * Resolve a user's role in a project with a 60s in-process LRU cache.
 */
export async function getProjectRole(projectId, userId) {
    const cacheKey = `${projectId}:${userId}`;
    const cached = projectRoleCache.get(cacheKey);
    if (cached !== undefined) {
        recordCacheRequest('projectRole', 'hit');
        return cached === NO_ROLE ? null : cached;
    }
    recordCacheRequest('projectRole', 'miss');
    const result = await pool.query(`SELECT pm.role
     FROM project_members pm
     JOIN projects p ON p.id = pm.project_id
     WHERE pm.project_id = $1 AND pm.user_id = $2 AND pm.status = 'active' AND p.deleted_at IS NULL
     LIMIT 1`, [projectId, userId]);
    const role = result.rows[0]?.role ?? null;
    projectRoleCache.set(cacheKey, role ?? NO_ROLE);
    return role;
}
/** Invalidate cached project role on member add, remove, or role update. */
export function invalidateProjectRoleCache(projectId, userId) {
    const key = `${projectId}:${userId}`;
    projectRoleCache.delete(key);
    void publishInvalidation("projectRole", key);
}
//# sourceMappingURL=tenant.js.map