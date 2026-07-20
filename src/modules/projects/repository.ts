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
  ProjectVisibility,
} from "./types.js";
import { ProjectError } from "./shared/utils.js";
import { ProjectRepository } from "./core/project.repository.js";
import { MemberRepository } from "./members/member.repository.js";
import { ProjectUsageRepository } from "./usage/project-usage.repository.js";
import { ProjectSettingsRepository } from "./settings/project-settings.repository.js";

export interface ProjectModuleUsageCounts {
  projects: number;
  environments: number;
  apiKeys: number;
}

export class ProjectsRepository {
  private readonly core: ProjectRepository;
  private readonly members: MemberRepository;
  private readonly usage: ProjectUsageRepository;
  private readonly settings: ProjectSettingsRepository;

  constructor(private readonly db: Pool = pool) {
    this.core = new ProjectRepository(db);
    this.members = new MemberRepository(db);
    this.usage = new ProjectUsageRepository(db);
    this.settings = new ProjectSettingsRepository(db);
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
    const db = client ?? this.db;
    const result = await db.query<{ role: ProjectMemberRole }>(
      `SELECT role
         FROM project_members
        WHERE project_id = $1
          AND user_id = $2
          AND (status IS NULL OR status = 'active')
        LIMIT 1`,
      [projectId, userId],
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
      visibility?: ProjectVisibility | undefined;
      status?: ProjectStatus | undefined;
      timezone?: string | undefined;
      tags?: string[] | undefined;
      icon?: string | null | undefined;
      color?: string | null | undefined;
      metadata?: Record<string, unknown> | undefined;
      createdBy?: string | null | undefined;
    },
    client?: PoolClient,
  ): Promise<Project> {
    return this.core.createProject(input as any, client);
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

  async findSdkConfigPlanKey(
    orgId: string,
    client?: PoolClient,
  ): Promise<string> {
    return this.settings.findSdkConfigPlanKey(orgId, client);
  }

  async createDefaultSdkConfigs(
    project: Project,
    createdBy: string,
    planKey: string,
    client?: PoolClient,
  ): Promise<number> {
    return this.settings.createDefaultSdkConfigs(project, createdBy, planKey, client);
  }
}

export * from "./core/project.repository.js";
export * from "./members/member.repository.js";
export * from "./usage/project-usage.repository.js";
export * from "./settings/project-settings.repository.js";
