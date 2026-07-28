/** Project environment lifecycle and authorization service. */
import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "./environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import { type CreateEnvironmentBody, type ProjectEnvironmentConfig, type UpdateEnvironmentBody } from "./environment.types.js";
import { BaseProjectService, type RequestMeta } from "../shared/base.service.js";
export declare class EnvironmentService extends BaseProjectService {
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, auditService: OrganizationAuditService, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, usageRepository: UsageRepository);
    listEnvironments(orgId: string, projectId: string, userId: string, includeDeleted?: boolean): Promise<ProjectEnvironmentConfig[]>;
    getEnvironment(orgId: string, projectId: string, environmentId: string, userId: string): Promise<ProjectEnvironmentConfig>;
    createEnvironment(orgId: string, projectId: string, userId: string, body: CreateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    updateEnvironment(orgId: string, projectId: string, environmentId: string, userId: string, body: UpdateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    deleteEnvironment(orgId: string, projectId: string, environmentId: string, userId: string, meta: RequestMeta): Promise<void>;
    restoreEnvironment(orgId: string, projectId: string, environmentId: string, userId: string, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    setDefaultEnvironment(orgId: string, projectId: string, environmentId: string, userId: string, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    deactivateEnvironment(orgId: string, projectId: string, environmentId: string, userId: string, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    private writeAudit;
}
//# sourceMappingURL=environment.service.d.ts.map