/**
 * Project repository facade.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Delegate reads/writes to the bounded-context repositories (core projects,
 *    members, usage, settings).
 * 3. Translate expected DB conflicts/misses into ProjectError with stable codes.
 *
 * Tenant isolation: every project/key query is scoped by org_id (and
 * project_id) so a caller can never read or mutate another org's data.
 * Soft delete: projects set deleted_at; all reads filter deleted_at IS NULL.
 */
import type { Pool, PoolClient } from "pg";
import { pool } from "../../config/database.js";
import type {
  ListProjectsQuery,
  OrganizationMembership,
  OrgRole,
  Project,
  ProjectListItem,
  ProjectMember,
  ProjectMemberRole,
  ProjectStatus,
  ProjectUpdateInput,
  ProjectUsageCounter,
} from "./types.js";
import { ProjectError } from "./shared/utils.js";
import { ProjectRepository } from "./core/project.repository.js";
import { MemberRepository } from "./members/member.repository.js";
import { ProjectUsageRepository } from "./usage/project-usage.repository.js";
import { getProjectRole } from "../../shared/middleware/tenant.js";

export interface ProjectModuleUsageCounts {
  projects: number;
  environments: number;
  apiKeys: number;
}

export class ProjectsRepository {
  private readonly core: ProjectRepository;
  private readonly members: MemberRepository;
  private readonly usage: ProjectUsageRepository;

  constructor(private readonly db: Pool = pool) {
    this.core = new ProjectRepository(db);
    this.members = new MemberRepository(db);
    this.usage = new ProjectUsageRepository(db);
  }

  async withTransaction<T>(
    callback: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.core.withTransaction(callback);
  }

  // ── Membership ────────────────────────────────────────────────────────────

  async findOrganizationMembership(
    orgId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<OrganizationMembership | null> {
    return this.members.findOrganizationMembership(orgId, userId, client);
  }

  async getProjectMemberRole(
    orgId: string,
    projectId: string,
    userId: string,
    client?: PoolClient,
  ): Promise<ProjectMemberRole | null> {
    if (!client) {
      const cached = await getProjectRole(projectId, userId);
      if (cached !== null) return cached as ProjectMemberRole;
    }
    const db = client ?? this.db;
    const result = await db.query<{ role: ProjectMemberRole }>(
      `SELECT pm.role
         FROM project_members pm
         JOIN projects p
           ON p.id = pm.project_id
          AND p.org_id = pm.organization_id
        WHERE pm.organization_id = $1
          AND pm.project_id = $2
          AND pm.user_id = $3
          AND pm.status = 'active'
          AND p.org_id = $1
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [orgId, projectId, userId],
    );
    return result.rows[0]?.role ?? null;
  }

  async addProjectMember(
    projectId: string,
    organizationId: string,
    userId: string,
    role: ProjectMemberRole,
    addedByUserId: string,
    client?: PoolClient,
  ): Promise<ProjectMember> {
    return this.members.addProjectMember(
      projectId,
      organizationId,
      userId,
      role,
      addedByUserId,
      client,
    );
  }

  async ensureProjectOwner(
    projectId: string,
    organizationId: string,
    userId: string,
    client: PoolClient,
  ): Promise<ProjectMember> {
    return this.members.ensureProjectOwner(projectId, organizationId, userId, client);
  }

  // ── Projects ────────────────────────────────────────────────────────────────

  async listProjects(
    orgId: string,
    query: ListProjectsQuery,
    client?: PoolClient,
  ): Promise<{ projects: ProjectListItem[]; total: number }> {
    return this.core.listProjects(orgId, query, client);
  }

  async createProject(
    input: {
      orgId: string;
      name: string;
      slug: string;
      description: string | null;
      status?: ProjectStatus | undefined;
      timezone?: string | undefined;
      tags?: string[] | undefined;
      icon?: string | null | undefined;
      metadata?: Record<string, unknown> | undefined;
      createdBy?: string | null | undefined;
    },
    client?: PoolClient,
  ): Promise<Project> {
    return this.core.createProject(input as any, client);
  }

  async provisionUsageCounter(project: Project, client: PoolClient): Promise<void> {
    return this.core.provisionUsageCounter(project, client);
  }

  async findProjectBySlug(
    orgId: string,
    slug: string,
    client?: PoolClient,
  ): Promise<Project | null> {
    return this.core.findProjectBySlug(orgId, slug, client);
  }

  async findProjectById(
    orgId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<Project | null> {
    return this.core.findProjectById(orgId, projectId, client);
  }

  async findProjectByPublicId(
    orgId: string,
    publicId: string,
    client?: PoolClient,
  ): Promise<Project | null> {
    return this.core.findProjectByPublicId(orgId, publicId, client);
  }

  async findProjectByIdIncludingDeleted(
    orgId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<Project | null> {
    return this.core.findProjectByIdIncludingDeleted(orgId, projectId, client);
  }

  async updateProject(
    orgId: string,
    projectId: string,
    input: ProjectUpdateInput,
    client?: PoolClient,
  ): Promise<Project> {
    return this.core.updateProject(orgId, projectId, input, client);
  }

  /** Soft-delete: stamp deleted_at + deleted_by; row is retained for audit. */
  async softDeleteProject(
    orgId: string,
    projectId: string,
    deletedBy: string,
    client?: PoolClient,
  ): Promise<void> {
    return this.core.softDeleteProject(orgId, projectId, deletedBy, client);
  }

  async restoreProject(
    orgId: string,
    projectId: string,
    client?: PoolClient,
  ): Promise<Project> {
    return this.core.restoreProject(orgId, projectId, client);
  }

  async getProjectStats(
    projectId: string,
    client?: PoolClient,
  ): Promise<{
    totalRequests: number;
    apiKeysCount: number;
    activeKeysCount: number;
    environmentCount: number;
  }> {
    return this.usage.getProjectStats(projectId, client);
  }

  async getProjectUsageCounters(
    projectId: string,
    client?: PoolClient,
  ): Promise<ProjectUsageCounter[]> {
    return this.usage.getProjectUsageCounters(projectId, client);
  }

  async getProjectModuleUsageCounts(
    orgId: string,
    client?: PoolClient,
  ): Promise<ProjectModuleUsageCounts> {
    return this.usage.getProjectModuleUsageCounts(orgId, client);
  }
}

export * from "./core/project.repository.js";
export * from "./members/member.repository.js";
export * from "./usage/project-usage.repository.js";
export * from "./settings/project-settings.repository.js";
