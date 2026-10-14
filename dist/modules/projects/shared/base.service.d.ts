import type { FastifyBaseLogger } from "fastify";
import type { BillingEntitlementsRow, OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import type { OrgRole, Project, ProjectUsageCounter, ProjectWithStats } from "../types.js";
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
export declare class BaseProjectService {
    readonly repository: ProjectsRepository;
    readonly logger: FastifyBaseLogger;
    readonly orgRepo: OrganizationRepository;
    readonly auditService: OrganizationAuditService;
    readonly settingsRepository: SettingsRepository;
    readonly apiKeyRepository: ApiKeyRepository;
    readonly environmentRepository: EnvironmentRepository;
    readonly usageRepository: UsageRepository;
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, auditService: OrganizationAuditService, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, usageRepository: UsageRepository);
    getProjectStats(orgId: string, projectId: string, userId: string): Promise<ProjectWithStats>;
    getProjectUsage(orgId: string, projectId: string, userId: string): Promise<ProjectUsageCounter[]>;
    requireOrganizationAccess(orgId: string, userId: string, requiredRole?: OrgRole): Promise<import("./schema-utils.js").OrganizationMembership>;
    requireProjectAccess(orgId: string, projectId: string, userId: string, requiredRole: OrgRole | ProjectMemberRole): Promise<Project>;
    limitFrom(entitlements: BillingEntitlementsRow, keys: string[], fallback?: number): number;
    assertWithinLimit(name: string, used: number, limit: number, increment?: number): void;
    requireMutableBilling(orgId: string): Promise<BillingEntitlementsRow>;
    enforceProjectModuleLimit(orgId: string, capability: "project" | "environment" | "apiKey", increment?: number): Promise<BillingEntitlementsRow>;
    generateUniqueSlug(orgId: string, name: string): Promise<string>;
    /**
     * Write a project/API-key lifecycle event to the organization audit trail.
     * Non-fatal: a failed audit write never breaks the originating request.
     */
    audit(meta: RequestMeta, data: {
        orgId: string;
        projectId: string;
        action: string;
        entityType: string;
        entityId?: string;
        entityName?: string;
        oldValues?: Record<string, unknown> | null;
        newValues?: Record<string, unknown> | null;
        changedFields?: string[];
        isSensitive?: boolean;
        metadata?: Record<string, unknown>;
    }): Promise<void>;
    evictProjectApiKeys(projectId: string): Promise<void>;
}
//# sourceMappingURL=base.service.d.ts.map