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
import { LRUCache } from "lru-cache";

import { pool } from "../../config/database.js";

// projectId -> orgId. 60s TTL: project ownership effectively never changes.
// A sentinel ("") marks "project does not exist" so we can negatively cache
// without violating the LRU value-type constraint (which disallows null).
const NO_ORG = "";
const projectOrgCache = new LRUCache<string, string>({
  max: 50_000,
  ttl: 60 * 1000,
  ttlAutopurge: true,
});

// `${orgId}:${userId}` -> isActiveMember. 30s TTL bounds how long a removed
// member can keep reading after revocation.
const membershipCache = new LRUCache<string, boolean>({
  max: 100_000,
  ttl: 30 * 1000,
  ttlAutopurge: true,
});

function unauthorized(
  reply: FastifyReply,
  code: string,
  message: string,
  status = 403,
): FastifyReply {
  return reply.status(status).send({ error: { code, message } });
}

function getParam(request: FastifyRequest, ...names: string[]): string | null {
  const params = (request.params ?? {}) as Record<string, unknown>;
  for (const name of names) {
    const value = params[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function getQueryParam(request: FastifyRequest, ...names: string[]): string | null {
  const query = (request.query ?? {}) as Record<string, unknown>;
  for (const name of names) {
    const value = query[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

function getBodyProjectId(request: FastifyRequest): string | null {
  const body = request.body;
  if (!body || typeof body !== "object") return null;
  const projectId = (body as Record<string, unknown>).projectId;
  return typeof projectId === "string" && projectId.length > 0 ? projectId : null;
}

async function resolveProjectOrg(projectId: string): Promise<string | null> {
  const cached = projectOrgCache.get(projectId);
  if (cached !== undefined) return cached === NO_ORG ? null : cached;

  const result = await pool.query<{ org_id: string }>(
    `SELECT org_id FROM projects WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [projectId],
  );
  const orgId = result.rows[0]?.org_id ?? null;
  projectOrgCache.set(projectId, orgId ?? NO_ORG);
  return orgId;
}

async function isActiveMember(orgId: string, userId: string): Promise<boolean> {
  const cacheKey = `${orgId}:${userId}`;
  const cached = membershipCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await pool.query<{ ok: boolean }>(
    `SELECT TRUE AS ok
     FROM organization_members
     WHERE org_id = $1 AND user_id = $2 AND status = 'active'
     LIMIT 1`,
    [orgId, userId],
  );
  const ok = result.rows.length > 0;
  membershipCache.set(cacheKey, ok);
  return ok;
}

/**
 * Require the authenticated caller to be an active member of the organization
 * that owns the `:projectId` in the route. Use as a preHandler AFTER
 * `authenticate`.
 */
async function assertProjectMembership(
  request: FastifyRequest,
  reply: FastifyReply,
  projectId: string | null,
): Promise<boolean> {
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
    unauthorized(
      reply,
      "INSUFFICIENT_PERMISSIONS",
      "You do not have access to this project",
      403,
    );
    return false;
  }

  return true;
}

export async function requireProjectMembership(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const projectId = getParam(request, "projectId", "project_id");
  if (!(await assertProjectMembership(request, reply, projectId))) return;
}

/** Use when projectId is supplied via query string (ingestion read APIs). */
export async function requireProjectMembershipFromQuery(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const projectId = getQueryParam(request, "projectId", "project_id");
  if (!(await assertProjectMembership(request, reply, projectId))) return;
}

/** Use when projectId is in the JSON body (e.g. replay). */
export async function requireProjectMembershipFromBody(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const projectId = getBodyProjectId(request);
  if (!(await assertProjectMembership(request, reply, projectId))) return;
}

/**
 * Require the authenticated caller to be an active member of `:orgId`.
 * Use as a preHandler AFTER `authenticate`.
 */
export async function requireOrgMembership(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = request.user?.id;
  const orgId = getParam(request, "orgId", "org_id");

  if (!userId) {
    return void unauthorized(reply, "UNAUTHORIZED", "Authentication required", 401);
  }
  if (!orgId) {
    return void unauthorized(
      reply,
      "VALIDATION_ERROR",
      "Organization context is required",
      400,
    );
  }
  if (!(await isActiveMember(orgId, userId))) {
    return void unauthorized(
      reply,
      "INSUFFICIENT_PERMISSIONS",
      "You do not have access to this organization",
      403,
    );
  }
}

/**
 * Invalidate cached membership for a user in an org. Call this from the org
 * service when a member is removed/suspended/role-changed so the read guards
 * reflect the change immediately rather than after the TTL.
 */
export function invalidateMembershipCache(orgId: string, userId: string): void {
  membershipCache.delete(`${orgId}:${userId}`);
}

/** Invalidate the cached project->org mapping (e.g. on project delete). */
export function invalidateProjectOrgCache(projectId: string): void {
  projectOrgCache.delete(projectId);
}
