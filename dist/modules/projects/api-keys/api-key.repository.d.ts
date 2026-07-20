/**
 * Project API key repository.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Execute parameterized SQL against project_api_keys and project_environments.
 * 3. Map snake_case rows into camelCase domain objects.
 * 4. Translate expected DB conflicts/misses into ProjectError with stable codes.
 *
 * Tenant isolation: every API key query is scoped by org_id (and project_id).
 * Soft delete: API keys use deleted_at; reads filter deleted_at IS NULL.
 */
import type { Pool, PoolClient } from "pg";
import type { ApiKeyType, ListApiKeysQuery, Project, ProjectApiKey, ProjectApiKeyRecord } from "../types.js";
export interface ApiKeyUpdateInput {
    name?: string | null;
    description?: string | null;
    expiresAt?: Date | null;
    autoRotateEnabled?: boolean;
    autoRotateDays?: number;
    permissions?: string[];
    allowedEndpoints?: string[];
    blockedEndpoints?: string[];
    allowedEventTypes?: string[];
    allowedOrigins?: string[];
    allowedIps?: string[];
    allowedDomains?: string[];
    samplingRules?: Record<string, unknown>;
    featureFlags?: Record<string, unknown>;
    sdkConfig?: Record<string, unknown>;
    rateLimitPerSecond?: number | null;
    rateLimitPerMinute?: number | null;
    rateLimitPerHour?: number | null;
}
export declare class ApiKeyRepository {
    private readonly db;
    constructor(db?: Pool);
    listApiKeys(projectId: string, query: ListApiKeysQuery, client?: PoolClient): Promise<{
        keys: ProjectApiKey[];
        total: number;
    }>;
    createApiKey(input: {
        projectId: string;
        orgId: string;
        publicKey: string;
        secretHash: string;
        keyType: ApiKeyType;
        environmentId: string;
        name: string | null;
        description: string | null;
        createdBy: string;
        expiresAt: Date | null;
        autoRotateEnabled?: boolean | undefined;
        autoRotateDays?: number | undefined;
        permissions: string[];
        allowedEndpoints?: string[] | undefined;
        blockedEndpoints?: string[] | undefined;
        allowedEventTypes?: string[] | undefined;
        allowedOrigins?: string[] | undefined;
        allowedIps?: string[] | undefined;
        allowedDomains?: string[] | undefined;
        samplingRules?: Record<string, unknown> | undefined;
        featureFlags?: Record<string, unknown> | undefined;
        sdkConfig?: Record<string, unknown> | undefined;
        rateLimitPerSecond?: number | null | undefined;
        rateLimitPerMinute?: number | null | undefined;
        rateLimitPerHour?: number | null | undefined;
        rotatedFromKeyId?: string | null | undefined;
    }, client?: PoolClient): Promise<ProjectApiKeyRecord>;
    countActiveApiKeys(projectId: string, environmentId: string, client?: PoolClient): Promise<number>;
    findApiKeyById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKey | null>;
    findApiKeyRecordById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKeyRecord | null>;
    listActiveApiKeyRecords(projectId: string, environmentId: string | undefined, client?: PoolClient): Promise<ProjectApiKeyRecord[]>;
    updateApiKey(projectId: string, apiKeyId: string, input: ApiKeyUpdateInput, client?: PoolClient): Promise<ProjectApiKey>;
    /** Enable/disable the fast ingestion gate and sync the lifecycle status. */
    setApiKeyActiveState(projectId: string, apiKeyId: string, isActive: boolean, client?: PoolClient): Promise<ProjectApiKey>;
    /** Revoke a key permanently: deactivate, set status + reason + actor. */
    revokeApiKey(projectId: string, apiKeyId: string, revokedBy: string, reason: string | null, client?: PoolClient): Promise<ProjectApiKey>;
    /**
     * Mark a rotated key. If gracePeriodEndsAt is in the future the key stays
     * active (is_active stays TRUE) until then; otherwise it is deactivated now.
     */
    markApiKeyRotated(projectId: string, apiKeyId: string, rotatedBy: string, reason: string | null, gracePeriodEndsAt: Date | null, client?: PoolClient): Promise<void>;
    touchApiKeyLastUsed(apiKeyId: string, ip?: string | null, client?: PoolClient): Promise<void>;
    /** All key hashes of a project, for cache eviction on pause/archive/delete. */
    listApiKeyHashesByProject(projectId: string, client?: PoolClient): Promise<string[]>;
    /**
     * Candidate lookup for verification. Narrows by public_key to the small set of
     * keys that could match, then the service does the constant-time hash compare.
     * Includes keys that are active OR in a still-valid rotation grace window.
     */
    findActiveApiKeyCandidatesByPrefix(publicKey: string, client?: PoolClient): Promise<Array<{
        apiKey: ProjectApiKeyRecord;
        project: Project;
        environmentName: string;
    }>>;
    getApiKeyUsageSummary(keyId: string, client?: PoolClient): Promise<{
        totalRequests: number;
        totalSuccess: number;
        totalErrors: number;
        bytesIngested: number;
        eventsIngested: number;
        requestsByDay: Array<{
            date: string;
            count: number;
        }>;
    }>;
    /** Build a ProjectRow from the p_*-prefixed columns of the candidate join. */
    private prefixedProjectRow;
    private mapProject;
    private mapApiKey;
    private mapApiKeyRecord;
}
//# sourceMappingURL=api-key.repository.d.ts.map