/**
 * Project business service.
 *
 * Flow:
 * 1. Authorize via organization membership before any read/mutation (tenant
 *    isolation root check). Role gating is centralized in requireProjectAccess.
 * 2. Enforce project status transitions, API-key limits, and key lifecycle.
 * 3. Mint key material in memory; persist only hash + prefix; return the full
 *    key exactly once.
 * 4. Warm/evict the in-process LRU (config/lrucashe.ts, 30-min TTL) so ingestion
 *    resolves keys without a Postgres round trip. NO Redis.
 * 5. Write every sensitive lifecycle event to organization_audit_logs (projects
 *    and API keys are org-owned resources, so they share the org audit trail).
 */
import type { FastifyBaseLogger } from "fastify";
import type { PoolClient } from "pg";
import { apiKeyCache, type CachedProjectConfig } from "../../../config/lrucashe.js";
import type { BillingEntitlementsRow, OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import { ProjectMemberRole, type ProjectOverviewDto, type ProjectSettings } from "../types.js";
import { AlertCategorySchema } from "../alerts/subscriptions/connector-subscription.types.js";
import {
  ProjectsRepository,
  type ProjectModuleUsageCounts
} from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import type {
  ApiKeyUsage,
  BulkOperationResult,
  BulkRevokeBody,
  BulkRotateBody,
  CreateApiKeyBody,
  CreateApiKeyResponse,
  CreateEnvironmentBody,
  CreateProjectBody,
  ListApiKeysQuery,
  ListProjectsQuery,
  OrgRole,
  Project,
  ProjectApiKey,
  ProjectApiKeyRecord,
  ProjectEnvironmentConfig,
  ProjectListItem,
  ProjectUsageCounter,
  ProjectWithStats,
  RotateApiKeyBody,
  UpdateApiKeyBody,
  UpdateEnvironmentBody,
  UpdateProjectBody,
  ValidatedApiKey, ProjectUpdateInput, ApiKeyUpdateInput } from "../types.js";
import {
  createApiKey,
  ProjectError,
  slugifyProjectName,
  validateStatusTransition,
} from "../shared/utils.js";
import { BaseProjectService } from "../shared/base.service.js";
import { EnvironmentType } from "../environments/environment.types.js";
import { SdkConfigProvisioner } from "../sdk-config/sdk-config.provisioner.js";

/**
 * Result of creating a project: the project itself plus the single Production
 * environment provisioned with it and the initial Production API key. The raw
 * key (`fullKey`) is returned exactly once and never persisted in plaintext.
 */
export interface CreateProjectResult {
  project: Project;
  environment: ProjectEnvironmentConfig;
  apiKey: ProjectApiKey;
  fullKey: string;
}

/** Fixed identity of the single default environment created with every project. */
const DEFAULT_PRODUCTION_ENVIRONMENT = {
  name: "Production",
  slug: "production",
  type: EnvironmentType.PRODUCTION,
  description: "Production telemetry",
  color: "#16A34A",
} as const;

// Audit/request footprint passed from routes. Mirrors the organization
// module's RequestMeta so audit rows are uniform across modules.
export interface RequestMeta {
  actorUserId: string;
  actorEmail: string | null;
  actorSessionId: string | null;
  actorIp: string;
  actorUserAgent: string | null;
  requestId: string;
  httpMethod: string;
  endpoint: string;
}

export class ProjectService extends BaseProjectService {
  constructor(
    repository: ProjectsRepository,
    logger: FastifyBaseLogger,
    // Org-owned audit trail. Projects/keys are organization resources, so their
    // lifecycle events live in organization_audit_logs.
    orgRepo: OrganizationRepository,
    auditService: OrganizationAuditService,
    settingsRepository: SettingsRepository,
    apiKeyRepository: ApiKeyRepository,
    environmentRepository: EnvironmentRepository,
    usageRepository: UsageRepository,
    private readonly sdkConfigProvisioner: SdkConfigProvisioner = new SdkConfigProvisioner(),
  ) {
      super(repository, logger, orgRepo, auditService, settingsRepository, apiKeyRepository, environmentRepository, usageRepository);
  }

  // ── Projects ────────────────────────────────────────────────────────────────

  public async listProjects(
    orgId: string,
    userId: string,
    query: ListProjectsQuery,
  ): Promise<{
    projects: ProjectListItem[];
    total: number;
    limit: number;
    offset: number;
  }> {
    await this.requireOrganizationAccess(orgId, userId);
    const result = await this.repository.listProjects(orgId, query);
    const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
    return { ...result, limit: query.limit, offset };
  }

  /**
   * Create a project and provision a complete, production-ready runtime in a
   * single database transaction:
   *   1. Project row
   *   2. Owner membership
   *   3. Project settings
   *   4. Exactly ONE Production environment (default, active)
   *   5. SDK configuration head + published revision #1 for that environment
   *   6. One initial Production API key (shown once)
   *   7. Usage counters
   *   8. Notification preferences
   *
   * No additional environments (Staging/Development/Testing/Preview/...) are
   * created here — those exist only when the user explicitly creates them.
   */
  public async createProject(
    orgId: string,
    userId: string,
    body: CreateProjectBody,
    meta: RequestMeta,
  ): Promise<CreateProjectResult> {
    await this.requireOrganizationAccess(orgId, userId, "admin");
    await this.enforceProjectModuleLimit(orgId, "project");
    const slug = await this.generateUniqueSlug(orgId, body.name);

    const keyMaterial = createApiKey(DEFAULT_PRODUCTION_ENVIRONMENT.slug);

    const result = await this.repository.withTransaction(async (client) => {
      const project = await this.repository.createProject(
        {
          orgId,
          name: body.name,
          slug,
          description: body.description ?? null,
          visibility: body.visibility ?? "private",
          status: body.status ?? "active",
          timezone: body.timezone ?? "UTC",
          tags: body.tags ?? [],
          icon: body.icon ?? null,
          color: body.color ?? null,
          metadata: body.metadata ?? {},
          createdBy: userId,
        },
        client,
      );

      await this.repository.ensureProjectOwner(project.id, orgId, userId, client);
      await this.settingsRepository.createDefault(project.id, orgId, client);

      // Exactly one Production environment. All runtime resources below are
      // provisioned explicitly in this same transaction (no DB trigger).
      const environment = await this.environmentRepository.createEnvironment(
        {
          projectId: project.id,
          orgId,
          name: DEFAULT_PRODUCTION_ENVIRONMENT.name,
          slug: DEFAULT_PRODUCTION_ENVIRONMENT.slug,
          type: DEFAULT_PRODUCTION_ENVIRONMENT.type,
          description: DEFAULT_PRODUCTION_ENVIRONMENT.description,
          color: DEFAULT_PRODUCTION_ENVIRONMENT.color,
          isDefault: true,
          isActive: true,
        },
        client,
      );

      // SDK configuration head + published revision #1 for the environment.
      await this.sdkConfigProvisioner.provisionInitial(
        client,
        {
          organizationId: orgId,
          projectId: project.id,
          environmentId: environment.id,
          environmentKey: environment.slug,
        },
        userId,
      );

      // One initial Production API key (subsequent environments do NOT get keys).
      const apiKey = await this.apiKeyRepository.createApiKey(
        {
          projectId: project.id,
          organizationId: orgId,
          environmentId: environment.id,
          publicKey: keyMaterial.publicKey,
          secretHash: keyMaterial.secretHash,
          name: "Production Default Key",
          createdBy: userId,
          expiresAt: null,
        },
        client,
      );

      await this.repository.provisionUsageCounter(project, client);
      await this.seedDefaultNotificationPreferences(project.id, orgId, client);

      return { project, environment, apiKey };
    });

    await this.audit(meta, {
      orgId,
      projectId: result.project.id,
      action: "project.created",
      entityType: "project",
      entityId: result.project.id,
      entityName: result.project.name,
      newValues: {
        name: result.project.name,
        slug: result.project.slug,
        visibility: result.project.visibility,
        environmentId: result.environment.id,
        apiKeyId: result.apiKey.id,
      },
    });

    this.logger.info(
      { orgId, projectId: result.project.id, environmentId: result.environment.id, userId },
      "Project created with Production environment, SDK configuration, and initial API key",
    );

    return {
      project: result.project,
      environment: result.environment,
      apiKey: this.apiKeyRepository.publicShape(result.apiKey),
      fullKey: keyMaterial.fullKey,
    };
  }

  private async seedDefaultNotificationPreferences(
    projectId: string,
    orgId: string,
    client: PoolClient,
  ): Promise<void> {
    const categories = AlertCategorySchema.options;
    if (categories.length === 0) return;

    const placeholders: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    for (const category of categories) {
      placeholders.push(`($${i++}, $${i++}, $${i++}, TRUE)`);
      values.push(projectId, orgId, category);
    }

    await client.query(
      `INSERT INTO project_notification_preferences (
         project_id, organization_id, category, enabled
       ) VALUES ${placeholders.join(", ")}
       ON CONFLICT DO NOTHING`,
      values,
    );
  }

  public async getProject(orgId: string, projectId: string, userId: string): Promise<Project> {
    return this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
  }

  public async getProjectOverview(orgId: string, projectId: string, userId: string): Promise<ProjectOverviewDto> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, ProjectMemberRole.VIEWER);
    const settings = await this.settingsRepository.findByProjectId(projectId);
    if (!settings) throw new ProjectError("SETTINGS_NOT_FOUND", "Project settings not found", 404);
    const usage = await this.usageRepository.getProjectOverview(orgId, projectId);

    return {
      project,
      settings,
      memberCount: usage.memberCount,
      apiKeyCount: usage.apiKeyCount,
      usage: {
        totalEventsToday: usage.totalEventsToday,
        totalBytesToday: usage.totalBytesToday,
        peakHour: usage.peakHour,
        currentHourEvents: usage.currentHourEvents,
        categoryBreakdown: usage.categoryBreakdown,
        eventTypeBreakdown: usage.eventTypeBreakdown,
        hourlyBreakdown: usage.hourlyBreakdown,
        dailyTrend: usage.dailyTrend,
        heatmapData: usage.heatmapData,
      },
    };
  }

  public async updateProject(
    orgId: string,
    projectId: string,
    userId: string,
    body: UpdateProjectBody,
    meta: RequestMeta,
  ): Promise<Project> {
    const current = await this.requireProjectAccess(orgId, projectId, userId, "admin");

    if (body.status && body.status !== current.status &&
        !validateStatusTransition(current.status, body.status)) {
      throw new ProjectError(
        "PROJECT_INVALID_TRANSITION",
        `Cannot transition project from ${current.status} to ${body.status}`,
        400,
      );
    }
    if (body.status === "active" && current.status !== "active") {
      await this.requireMutableBilling(orgId);
    }

    const updates: ProjectUpdateInput = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.status !== undefined) {
      updates.status = body.status;
      updates.archivedAt = body.status === "archived" ? new Date() : null;
    }
    if (body.visibility !== undefined) updates.visibility = body.visibility;
    if (body.timezone !== undefined) updates.timezone = body.timezone;
    if (body.tags !== undefined) updates.tags = body.tags;
    if (body.icon !== undefined) updates.icon = body.icon;
    if (body.color !== undefined) updates.color = body.color;
    if (body.metadata !== undefined) updates.metadata = body.metadata;
    if (body.version !== undefined) updates.version = body.version;

    const updated = await this.repository.updateProject(orgId, projectId, updates);

    // If the project is no longer active, evict its cached keys now so ingestion
    // stops accepting data within this request rather than after the LRU TTL.
    if (body.status !== undefined && body.status !== "active") {
      await this.evictProjectApiKeys(projectId);
    }

    await this.audit(meta, {
      orgId,
      projectId,
      action: "project.updated",
      entityType: "project",
      entityId: updated.id,
      entityName: updated.name,
      changedFields: Object.keys(body),
      newValues: { status: updated.status },
    });

    return updated;
  }

  public async deleteProject(
    orgId: string,
    projectId: string,
    userId: string,
    meta: RequestMeta,
  ): Promise<void> {
    await this.requireProjectAccess(orgId, projectId, userId, "owner");
    // Evict cached keys BEFORE soft delete so ingestion stops resolving them
    // immediately. Revoke all keys so the secrets cannot be reactivated.
    await this.evictProjectApiKeys(projectId);
    await this.repository.withTransaction(async (client) => {
      const keys = await this.apiKeyRepository.listActiveApiKeyRecords(projectId, undefined, client);
      for (const key of keys) {
        await this.apiKeyRepository.revokeApiKey(projectId, key.id, client);
      }
      await this.repository.softDeleteProject(orgId, projectId, userId, client);
    });

    await this.audit(meta, {
      orgId,
      projectId,
      action: "project.deleted",
      entityType: "project",
      entityId: projectId,
      isSensitive: true,
    });
    this.logger.warn({ orgId, projectId, userId }, "Project soft-deleted");
  }

  public async restoreProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
    await this.requireOrganizationAccess(orgId, userId, "owner");
    const project = await this.repository.findProjectByIdIncludingDeleted(orgId, projectId);
    if (!project) throw new ProjectError("PROJECT_NOT_FOUND", "Project not found", 404);
    if (!project.deletedAt) return project;

    await this.enforceProjectModuleLimit(orgId, "project");
    const restored = await this.repository.restoreProject(orgId, projectId);

    await this.audit(meta, {
      orgId,
      projectId,
      action: "project.restored",
      entityType: "project",
      entityId: restored.id,
      entityName: restored.name,
      newValues: { status: restored.status },
    });
    return restored;
  }

  public async archiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
    if (project.status === "archived") return project;
    return this.updateProject(orgId, projectId, userId, { status: "archived" }, meta);
  }

  public async unarchiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
    if (project.status !== "archived") {
      throw new ProjectError("PROJECT_INVALID_TRANSITION", "Only archived projects can be unarchived", 400);
    }
    return this.updateProject(orgId, projectId, userId, { status: "active" }, meta);
  }

  public async pauseProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
    if (project.status === "paused") return project;
    return this.updateProject(orgId, projectId, userId, { status: "paused" }, meta);
  }

  public async resumeProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project> {
    const project = await this.requireProjectAccess(orgId, projectId, userId, "admin");
    if (project.status !== "paused") {
      throw new ProjectError("PROJECT_INVALID_TRANSITION", "Only paused projects can be resumed", 400);
    }
    return this.updateProject(orgId, projectId, userId, { status: "active" }, meta);
  }

  // ── Environments ─────────────────────────────────────────────────────────
  // ── API keys ─────────────────────────────────────────────────────────────
  // ── Verification (ingestion-facing) ─────────────────────────────────────────
  // ── Authorization ───────────────────────────────────────────────────────────
  // ── Internal helpers ────────────────────────────────────────────────────────
}
