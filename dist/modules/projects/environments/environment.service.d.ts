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
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import type { CreateEnvironmentBody, ProjectEnvironment, ProjectEnvironmentConfig, UpdateEnvironmentBody } from "../types.js";
import { BaseProjectService } from "../shared/base.service.js";
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
export declare function hasProjectRole(userRole: ProjectMemberRole, required: ProjectMemberRole): boolean;
export declare class EnvironmentService extends BaseProjectService {
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, activityRepository: ActivityRepository, usageRepository: UsageRepository);
    listEnvironments(orgId: string, projectId: string, userId: string): Promise<ProjectEnvironmentConfig[]>;
    getEnvironment(orgId: string, projectId: string, environment: ProjectEnvironment, userId: string): Promise<ProjectEnvironmentConfig>;
    createEnvironment(orgId: string, projectId: string, userId: string, body: CreateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    updateEnvironment(orgId: string, projectId: string, environment: ProjectEnvironment, userId: string, body: UpdateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    deleteEnvironment(orgId: string, projectId: string, environment: ProjectEnvironment, userId: string, meta: RequestMeta): Promise<void>;
}
//# sourceMappingURL=environment.service.d.ts.map