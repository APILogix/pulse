/**
 * API key business service.
 *
 * Flow:
 * 1. Authorize via project membership before any read/mutation.
 * 2. Enforce credential limits and lifecycle (`status` is authoritative).
 * 3. Mint key material in memory; persist only the hash + public key; return
 *    the full key exactly once.
 * 4. Record rotation workflow rows in `project_api_key_rotations`.
 * 5. Warm/evict the in-process LRU so ingestion resolves keys without a
 *    Postgres round trip. NO Redis.
 * 6. Write every sensitive lifecycle event to organization_audit_logs.
 */
import type { FastifyBaseLogger } from "fastify";
import type { OrganizationRepository } from "../../organization/repository.js";
import type { OrganizationAuditService } from "../../organization/audit-logs/audit-logs.service.js";
import { ProjectMemberRole } from "../types.js";
import { ProjectsRepository } from "../repository.js";
import { SettingsRepository } from "../settings/settings.repository.js";
import { ApiKeyRepository } from "./api-key.repository.js";
import { EnvironmentRepository } from "../environments/environment.repository.js";
import { UsageRepository } from "../usage/usage.repository.js";
import type { ApiKeyRotation, ApiKeyUsage, ApiKeyUsageQuery, ApiKeyUsageSeriesPoint, BulkOperationResult, BulkRevokeBody, BulkRotateBody, CreateApiKeyBody, CreateApiKeyResponse, ListApiKeysQuery, ProjectApiKey, ProjectApiKeyRecord, RotateApiKeyBody, UpdateApiKeyBody, ValidatedApiKey } from "../types.js";
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
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository, auditService: OrganizationAuditService, settingsRepository: SettingsRepository, apiKeyRepository: ApiKeyRepository, environmentRepository: EnvironmentRepository, usageRepository: UsageRepository);
    listApiKeys(orgId: string, projectId: string, userId: string, query: ListApiKeysQuery): Promise<{
        keys: ProjectApiKey[];
        total: number;
        limit: number;
        offset: number;
    }>;
    createApiKey(orgId: string, projectId: string, userId: string, body: CreateApiKeyBody, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    getApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string): Promise<ProjectApiKey>;
    updateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, body: UpdateApiKeyBody, meta: RequestMeta): Promise<ProjectApiKey>;
    /** Revoke a key with a reason. Soft state change, not row removal. */
    deleteApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta, reason?: string | null): Promise<ProjectApiKey>;
    rotateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, body: RotateApiKeyBody, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    /** Emergency regenerate: rotate with no grace window. */
    regenerateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    listApiKeyRotations(orgId: string, projectId: string, apiKeyId: string, userId: string): Promise<ApiKeyRotation[]>;
    enableApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<ProjectApiKey>;
    disableApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<ProjectApiKey>;
    bulkRotateKeys(orgId: string, projectId: string, userId: string, body: BulkRotateBody, meta: RequestMeta): Promise<BulkOperationResult>;
    bulkRevokeKeys(orgId: string, projectId: string, userId: string, body: BulkRevokeBody, meta: RequestMeta): Promise<BulkOperationResult>;
    /** Graph-ready per-key usage for the requested grain and window. */
    getApiKeyUsage(orgId: string, projectId: string, apiKeyId: string, userId: string, query: ApiKeyUsageQuery): Promise<ApiKeyUsage>;
    /**
     * Resolve a raw key to its validated context. The public key narrows the
     * candidate set, then a constant-time hash compare prevents timing leaks.
     * Enforces project status, expiry, and rotation grace.
     */
    validateApiKey(rawKey: string): Promise<ValidatedApiKey | null>;
    assertFutureExpiry(expiresAt: Date | null | undefined): void;
    /** Never let the secret verifier leave the service boundary. */
    publicApiKey(apiKey: ProjectApiKeyRecord | ProjectApiKey): ProjectApiKey;
    summarizeUsage(series: ApiKeyUsageSeriesPoint[]): ApiKeyUsage["summary"];
    summarizeBulk(results: BulkOperationResult["results"]): BulkOperationResult;
    evictApiKeyConfig(secretHash: string): void;
    /**
     * Best-effort adjustment of the organization's fast-path `api_keys_used`
     * counter. Failures are logged and swallowed: the counter only backs
     * dashboards/quota display, while the actual limit gate is the live
     * COUNT(*) enforced in `enforceProjectModuleLimit` before this is called.
     */
    private adjustOrgApiKeyUsage;
}
//# sourceMappingURL=api-key.service.d.ts.map