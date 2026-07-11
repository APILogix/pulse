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
import type { ApiKeyUsage, BulkOperationResult, BulkRevokeBody, BulkRotateBody, CreateApiKeyBody, CreateApiKeyResponse, ListApiKeysQuery, Project, ProjectApiKey, ProjectApiKeyRecord, RotateApiKeyBody, UpdateApiKeyBody, ValidatedApiKey } from "../types.js";
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
export declare class ApiKeyService extends BaseProjectService {
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, activityRepository: ActivityRepository, usageRepository: UsageRepository);
    listApiKeys(orgId: string, projectId: string, userId: string, query: ListApiKeysQuery): Promise<{
        keys: ProjectApiKey[];
        total: number;
        limit: number;
        offset: number;
    }>;
    createApiKey(orgId: string, projectId: string, userId: string, body: CreateApiKeyBody, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    getApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string): Promise<ProjectApiKey>;
    updateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, body: UpdateApiKeyBody, meta: RequestMeta): Promise<ProjectApiKey>;
    /** Revoke (delete) a key with a reason. Soft state change, not row removal. */
    deleteApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta, reason?: string | null): Promise<ProjectApiKey>;
    rotateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, body: RotateApiKeyBody, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    /** Emergency regenerate: rotate with no grace window (old key dies instantly). */
    regenerateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    enableApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<ProjectApiKey>;
    disableApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<ProjectApiKey>;
    bulkRotateKeys(orgId: string, projectId: string, userId: string, body: BulkRotateBody, meta: RequestMeta): Promise<BulkOperationResult>;
    bulkRevokeKeys(orgId: string, projectId: string, userId: string, body: BulkRevokeBody, meta: RequestMeta): Promise<BulkOperationResult>;
    getApiKeyUsage(orgId: string, projectId: string, apiKeyId: string, userId: string): Promise<ApiKeyUsage>;
    /**
     * Resolve a raw key to its validated context. Prefix narrows the candidate
     * set, then a constant-time hash compare prevents timing leaks. Enforces
     * project status, expiry, and rotation grace. Touches last_used_at async.
     */
    validateApiKey(rawKey: string): Promise<ValidatedApiKey | null>;
    assertFutureExpiry(expiresAt: Date | null | undefined): void;
    publicApiKey(apiKey: ProjectApiKeyRecord | ProjectApiKey): ProjectApiKey;
    summarizeBulk(results: BulkOperationResult["results"]): BulkOperationResult;
    /**
     * Warm the in-process LRU so ingestion resolves the key without a Postgres
     * round trip. Only active keys on active projects are cached as active;
     * ingestion re-validates project status on a miss.
     */
    warmApiKeyCache(keyHash: string, key: ProjectApiKeyRecord | ProjectApiKey, project: Project): void;
    evictApiKeyConfig(keyHash: string): void;
}
//# sourceMappingURL=api-key.service.d.ts.map