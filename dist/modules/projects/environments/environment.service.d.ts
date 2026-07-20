/**
 * Environment business service.
 *
 * Flow:
 * 1. Authorize via organization membership before any read/mutation.
 * 2. Manage project environments as first-class rows in project_environments.
 * 3. Write every lifecycle event to organization_audit_logs.
 */
import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../organization/repository.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import type { CreateEnvironmentBody, ProjectEnvironmentConfig, UpdateEnvironmentBody } from "../types.js";
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
export declare class EnvironmentService extends BaseProjectService {
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, activityRepository: ActivityRepository, usageRepository: UsageRepository);
    listEnvironments(orgId: string, projectId: string, userId: string): Promise<ProjectEnvironmentConfig[]>;
    getEnvironment(orgId: string, projectId: string, environmentId: string, userId: string): Promise<ProjectEnvironmentConfig>;
    createEnvironment(orgId: string, projectId: string, userId: string, body: CreateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    updateEnvironment(orgId: string, projectId: string, environmentId: string, userId: string, body: UpdateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    deleteEnvironment(orgId: string, projectId: string, environmentId: string, userId: string, meta: RequestMeta): Promise<void>;
}
//# sourceMappingURL=environment.service.d.ts.map