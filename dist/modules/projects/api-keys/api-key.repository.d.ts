/**
 * Project API key repository.
 *
 * The credential table holds identity and lifecycle only. Rotation workflow
 * history lives in `project_api_key_rotations`, and usage analytics live in the
 * partitioned `api_key_usage_minute` / `api_key_usage_daily` facts (with
 * read-only hourly/monthly views).
 *
 * Tenant isolation: every query is scoped by project (and organization for
 * writes). Soft delete: reads filter `deleted_at IS NULL`.
 */
import type { Pool, PoolClient } from "pg";
import type { ApiKeyRotation, ApiKeyStatus, ApiKeyUpdateInput, ApiKeyUsageGranularity, ApiKeyUsageSeriesPoint, ListApiKeysQuery, Project, ProjectApiKey, ProjectApiKeyRecord } from "../types.js";
type ApiKeyRow = {
    id: string;
    organization_id: string;
    project_id: string;
    environment_id: string;
    name: string;
    public_key: string;
    secret_hash: string;
    status: ApiKeyStatus;
    expires_at: Date | null;
    last_used_at: Date | null;
    created_by: string | null;
    rotated_from_key_id: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
};
export declare class ApiKeyRepository {
    private readonly db;
    constructor(db?: Pool);
    listApiKeys(projectId: string, query: ListApiKeysQuery, client?: PoolClient): Promise<{
        keys: ProjectApiKey[];
        total: number;
    }>;
    createApiKey(input: {
        projectId: string;
        organizationId: string;
        environmentId: string;
        publicKey: string;
        secretHash: string;
        name: string;
        createdBy: string;
        expiresAt: Date | null;
        rotatedFromKeyId?: string | null | undefined;
    }, client?: PoolClient): Promise<ProjectApiKeyRecord>;
    countActiveApiKeys(projectId: string, environmentId: string, client?: PoolClient): Promise<number>;
    findApiKeyById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKey | null>;
    findApiKeyRecordById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKeyRecord | null>;
    listActiveApiKeyRecords(projectId: string, environmentId: string | undefined, client?: PoolClient): Promise<ProjectApiKeyRecord[]>;
    updateApiKey(projectId: string, apiKeyId: string, input: ApiKeyUpdateInput, client?: PoolClient): Promise<ProjectApiKey>;
    /** Suspend/resume ingestion. `status` is the only lifecycle source of truth. */
    setApiKeyStatus(projectId: string, apiKeyId: string, status: Extract<ApiKeyStatus, "active" | "suspended">, client?: PoolClient): Promise<ProjectApiKey>;
    /** Revoke permanently. Reason/actor are captured by audit and rotation history. */
    revokeApiKey(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKey>;
    /** Mark the superseded credential as rotated. Grace lives on the rotation row. */
    markApiKeyRotated(projectId: string, apiKeyId: string, client?: PoolClient): Promise<void>;
    recordRotation(input: {
        organizationId: string;
        projectId: string;
        environmentId: string;
        oldKeyId: string;
        newKeyId: string;
        reason: string | null;
        initiatedBy: string;
        graceEndsAt: Date | null;
    }, client?: PoolClient): Promise<ApiKeyRotation>;
    listRotations(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ApiKeyRotation[]>;
    /** Finalize grace windows that have elapsed so rotated keys stop authenticating. */
    completeElapsedRotations(client?: PoolClient): Promise<number>;
    touchApiKeyLastUsed(apiKeyId: string, client?: PoolClient): Promise<void>;
    /** All key hashes of a project, for cache eviction on pause/archive/delete. */
    listApiKeyHashesByProject(projectId: string, client?: PoolClient): Promise<string[]>;
    /**
     * Candidate lookup for verification. Narrows by public_key, then the service
     * performs the constant-time hash compare. Accepts active keys and rotated
     * keys whose rotation grace window is still open.
     */
    findActiveApiKeyCandidatesByPrefix(publicKey: string, client?: PoolClient): Promise<Array<{
        apiKey: ProjectApiKeyRecord;
        project: Project;
        environmentName: string;
        environmentSlug: string;
        publishedConfig: Record<string, unknown>;
    }>>;
    /**
     * Graph-ready series for one key. Hourly reads the minute-derived view,
     * daily reads the physical daily fact, and monthly reads the daily-derived
     * view, so no grain re-aggregates another grain's percentiles or duplicates.
     */
    getApiKeyUsageSeries(apiKeyId: string, from: Date, to: Date, granularity: ApiKeyUsageGranularity, client?: PoolClient): Promise<ApiKeyUsageSeriesPoint[]>;
    private prefixedProjectRow;
    private mapProject;
    private mapRotation;
    mapApiKeyRecord(row: ApiKeyRow): ProjectApiKeyRecord;
    private mapApiKey;
    /** Strip the secret verifier before a credential leaves the repository. */
    publicShape(record: ProjectApiKeyRecord | ProjectApiKey): ProjectApiKey;
}
export {};
//# sourceMappingURL=api-key.repository.d.ts.map