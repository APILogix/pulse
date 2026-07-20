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
import type { BillingEntitlementsRow, OrganizationRepository } from "../../organization/repository.js";
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "../api-keys/api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { ActivityRepository } from "../activity/activity.repository.js";
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
    readonly settingsRepository: SettingsRepository;
    readonly apiKeyRepository: ApiKeyRepository;
    readonly environmentRepository: EnvironmentRepository;
    readonly activityRepository: ActivityRepository;
    readonly usageRepository: UsageRepository;
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, activityRepository: ActivityRepository, usageRepository: UsageRepository);
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