import type { FastifyReply, FastifyRequest } from "fastify";
import { pool } from "../../config/database.js";
import { hasRequiredRole, ProjectError } from "../../modules/projects/utils.js";
import type { OrgRole } from "../../modules/projects/types.js";

function getRouteIds(request: FastifyRequest): {
  orgId: string | null;
  projectId: string | null;
} {
  const params = (request.params ?? {}) as Record<string, unknown>;

  return {
    orgId:
      (typeof params.orgId === "string" && params.orgId) ||
      (typeof params.org_id === "string" && params.org_id) ||
      null,
    projectId:
      (typeof params.projectId === "string" && params.projectId) ||
      (typeof params.project_id === "string" && params.project_id) ||
      null,
  };
}

async function getMembership(orgId: string, userId: string) {
  const result = await pool.query<{
    role: OrgRole;
    is_active: boolean;
  }>(
    `SELECT role, is_active
     FROM organization_members
     WHERE org_id = $1 AND user_id = $2
     LIMIT 1`,
    [orgId, userId],
  );

  return result.rows[0] ?? null;
}

export async function requireOrgAccess(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const { orgId } = getRouteIds(request);
  const userId = request.user?.id;

  if (!orgId || !userId) {
    throw new ProjectError(
      "INSUFFICIENT_PERMISSIONS",
      "Organization context is required",
      403,
    );
  }

  const membership = await getMembership(orgId, userId);
  if (!membership || !membership.is_active) {
    throw new ProjectError(
      "INSUFFICIENT_PERMISSIONS",
      "You do not have access to this organization",
      403,
    );
  }
}

export async function requireProjectAdmin(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const { orgId, projectId } = getRouteIds(request);
  const userId = request.user?.id;

  if (!orgId || !projectId || !userId) {
    throw new ProjectError(
      "INSUFFICIENT_PERMISSIONS",
      "Project context is required",
      403,
    );
  }

  const [membership, project] = await Promise.all([
    getMembership(orgId, userId),
    pool.query(
      `SELECT id
       FROM projects
       WHERE id = $1 AND org_id = $2
       LIMIT 1`,
      [projectId, orgId],
    ),
  ]);

  if (!project.rows[0]) {
    throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
  }

  if (!membership || !membership.is_active || !hasRequiredRole(membership.role, "admin")) {
    throw new ProjectError(
      "INSUFFICIENT_PERMISSIONS",
      "Project admin access required",
      403,
    );
  }
}
