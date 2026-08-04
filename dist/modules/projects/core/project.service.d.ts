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
import type { OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import { type ProjectOverviewDto } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import type { CreateProjectBody, ListProjectsQuery, Project, ProjectApiKey, ProjectEnvironmentConfig, ProjectListItem, UpdateProjectBody } from "../types.js";
import { BaseProjectService } from "../shared/base.service.js";
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
export declare class ProjectService extends BaseProjectService {
    private readonly sdkConfigProvisioner;
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, auditService: OrganizationAuditService, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, usageRepository: UsageRepository, sdkConfigProvisioner?: SdkConfigProvisioner);
    listProjects(orgId: string, userId: string, query: ListProjectsQuery): Promise<{
        projects: ProjectListItem[];
        total: number;
        limit: number;
        offset: number;
    }>;
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
    createProject(orgId: string, userId: string, body: CreateProjectBody, meta: RequestMeta): Promise<CreateProjectResult>;
    private seedDefaultNotificationPreferences;
    getProject(orgId: string, projectId: string, userId: string): Promise<Project>;
    getProjectByPublicId(orgId: string, publicId: string, userId: string): Promise<Project>;
    getProjectOverview(orgId: string, projectId: string, userId: string): Promise<ProjectOverviewDto>;
    updateProject(orgId: string, projectId: string, userId: string, body: UpdateProjectBody, meta: RequestMeta): Promise<Project>;
    deleteProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<void>;
    restoreProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    archiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    unarchiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    pauseProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    resumeProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
}
//# sourceMappingURL=project.service.d.ts.map