/**
 * Project repository.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Execute parameterized SQL against projects, project_environments,
 *    project_api_keys, project_api_key_usage, and organization membership.
 * 3. Map snake_case rows into camelCase domain objects.
 * 4. Translate expected DB conflicts/misses into ProjectError with stable codes.
 *
 * Tenant isolation: every project/key query is scoped by org_id (and
 * project_id) so a caller can never read or mutate another org's data.
 * Soft delete: projects set deleted_at; all reads filter deleted_at IS NULL.
 */
import type { Pool, PoolClient } from "pg";
import type { ApiKeyType, ListApiKeysQuery, ListProjectActivityQuery, ListProjectsQuery, OrganizationMembership, Project, ProjectActivityResult, ProjectApiKey, ProjectApiKeyRecord, ProjectEnvironment, ProjectEnvironmentConfig, ProjectListItem, ProjectUsageCounter, ProjectStatus } from "./types.js";
export interface ProjectUpdateInput {
    name?: string;
    description?: string | null;
    status?: ProjectStatus;
    environment?: ProjectEnvironment;
    productionApiPrefix?: string | null;
    developmentApiPrefix?: string | null;
    stagingApiPrefix?: string | null;
    rateLimitPerSecond?: number;
    rateLimitPerMinute?: number;
    rateLimitPerHour?: number;
    burstLimit?: number;
    allowedEventTypes?: string[];
    maxEventSizeBytes?: number;
    maxBatchSize?: number;
    allowedOrigins?: string[];
    requireHttps?: boolean;
    ipAllowlist?: string[] | null;
    ipBlocklist?: string[] | null;
    geoRestrictionEnabled?: boolean;
    allowedCountries?: string[] | null;
    alertEmail?: string | null;
    alertWebhookUrl?: string | null;
    alertOnErrorRateThreshold?: number;
    alertOnLatencyThresholdMs?: number;
    metadata?: Record<string, unknown>;
    settings?: Record<string, unknown>;
    archivedAt?: Date | null;
}
export interface ApiKeyUpdateInput {
    name?: string | null;
    description?: string | null;
    expiresAt?: Date | null;
    autoRotateEnabled?: boolean;
    autoRotateDays?: number;
    permissions?: string[];
    allowedEndpoints?: string[];
    blockedEndpoints?: string[];
    rateLimitPerSecond?: number | null;
    rateLimitPerMinute?: number | null;
    rateLimitPerHour?: number | null;
}
export interface ProjectModuleUsageCounts {
    projects: number;
    environments: number;
    apiKeys: number;
}
export declare class ProjectsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    findOrganizationMembership(orgId: string, userId: string, client?: PoolClient): Promise<OrganizationMembership | null>;
    listProjects(orgId: string, query: ListProjectsQuery, client?: PoolClient): Promise<{
        projects: ProjectListItem[];
        total: number;
    }>;
    createProject(input: {
        orgId: string;
        name: string;
        slug: string;
        description: string | null;
        environment: ProjectEnvironment;
        productionApiPrefix: string | null;
        developmentApiPrefix: string | null;
        stagingApiPrefix: string | null;
        config: ProjectUpdateInput;
    }, client?: PoolClient): Promise<Project>;
    findProjectBySlug(orgId: string, slug: string, client?: PoolClient): Promise<Project | null>;
    findProjectById(orgId: string, projectId: string, client?: PoolClient): Promise<Project | null>;
    findProjectByIdIncludingDeleted(orgId: string, projectId: string, client?: PoolClient): Promise<Project | null>;
    updateProject(orgId: string, projectId: string, input: ProjectUpdateInput, client?: PoolClient): Promise<Project>;
    /** Soft-delete: stamp deleted_at + deleted_by; row is retained for audit. */
    softDeleteProject(orgId: string, projectId: string, deletedBy: string, client?: PoolClient): Promise<void>;
    restoreProject(orgId: string, projectId: string, client?: PoolClient): Promise<Project>;
    getProjectStats(projectId: string, client?: PoolClient): Promise<{
        totalRequests: number;
        apiKeysCount: number;
        activeKeysCount: number;
        environmentCount: number;
    }>;
    getProjectUsageCounters(projectId: string, client?: PoolClient): Promise<ProjectUsageCounter[]>;
    listProjectActivity(orgId: string, projectId: string, query: ListProjectActivityQuery, client?: PoolClient): Promise<ProjectActivityResult>;
    getProjectModuleUsageCounts(orgId: string, client?: PoolClient): Promise<ProjectModuleUsageCounts>;
    findSdkConfigPlanKey(orgId: string, client?: PoolClient): Promise<string>;
    createDefaultEnvironments(project: Project, createdBy: string, client?: PoolClient): Promise<ProjectEnvironmentConfig[]>;
    createDefaultSdkConfigs(project: Project, createdBy: string, planKey: string, client?: PoolClient): Promise<number>;
    listEnvironments(projectId: string, client?: PoolClient): Promise<ProjectEnvironmentConfig[]>;
    findEnvironment(projectId: string, environment: ProjectEnvironment, client?: PoolClient): Promise<ProjectEnvironmentConfig | null>;
    createEnvironment(input: {
        projectId: string;
        orgId: string;
        environment: ProjectEnvironment;
        createdBy: string;
        isActive?: boolean | undefined;
        rateLimitPerSecond?: number | null | undefined;
        rateLimitPerMinute?: number | null | undefined;
        rateLimitPerHour?: number | null | undefined;
        burstLimit?: number | null | undefined;
        allowedEventTypes?: string[] | undefined;
        maxEventSizeBytes?: number | null | undefined;
        maxBatchSize?: number | null | undefined;
        requireHttps?: boolean | undefined;
        ipAllowlist?: string[] | null | undefined;
        ipBlocklist?: string[] | null | undefined;
        alertEmail?: string | null | undefined;
        alertWebhookUrl?: string | null | undefined;
    }, client?: PoolClient): Promise<ProjectEnvironmentConfig>;
    updateEnvironment(projectId: string, environment: ProjectEnvironment, input: {
        isActive?: boolean | undefined;
        rateLimitPerSecond?: number | null | undefined;
        rateLimitPerMinute?: number | null | undefined;
        rateLimitPerHour?: number | null | undefined;
        burstLimit?: number | null | undefined;
        allowedEventTypes?: string[] | undefined;
        maxEventSizeBytes?: number | null | undefined;
        maxBatchSize?: number | null | undefined;
        requireHttps?: boolean | undefined;
        ipAllowlist?: string[] | null | undefined;
        ipBlocklist?: string[] | null | undefined;
        alertEmail?: string | null | undefined;
        alertWebhookUrl?: string | null | undefined;
    }, client?: PoolClient): Promise<ProjectEnvironmentConfig>;
    deleteEnvironment(projectId: string, environment: ProjectEnvironment, client?: PoolClient): Promise<void>;
    listApiKeys(projectId: string, query: ListApiKeysQuery, client?: PoolClient): Promise<{
        keys: ProjectApiKey[];
        total: number;
    }>;
    createApiKey(input: {
        projectId: string;
        orgId: string;
        keyHash: string;
        keyPrefix: string;
        keyType: ApiKeyType;
        environment: ProjectEnvironment;
        name: string | null;
        description: string | null;
        createdBy: string;
        expiresAt: Date | null;
        autoRotateEnabled?: boolean | undefined;
        autoRotateDays?: number | undefined;
        permissions: string[];
        allowedEndpoints?: string[] | undefined;
        blockedEndpoints?: string[] | undefined;
        rateLimitPerSecond?: number | null | undefined;
        rateLimitPerMinute?: number | null | undefined;
        rateLimitPerHour?: number | null | undefined;
        rotatedFromKeyId?: string | null | undefined;
    }, client?: PoolClient): Promise<ProjectApiKeyRecord>;
    countActiveApiKeys(projectId: string, environment: ProjectEnvironment, client?: PoolClient): Promise<number>;
    findApiKeyById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKey | null>;
    findApiKeyRecordById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKeyRecord | null>;
    listActiveApiKeyRecords(projectId: string, environment: ProjectEnvironment | undefined, client?: PoolClient): Promise<ProjectApiKeyRecord[]>;
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
     * Candidate lookup for verification. Narrows by prefix to the small set of
     * keys that could match, then the service does the constant-time hash compare.
     * Includes keys that are active OR in a still-valid rotation grace window.
     */
    findActiveApiKeyCandidatesByPrefix(keyPrefix: string, client?: PoolClient): Promise<Array<{
        apiKey: ProjectApiKeyRecord;
        project: Project;
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
    private buildProjectAssignments;
    /** Build a ProjectRow from the p_*-prefixed columns of the candidate join. */
    private prefixedProjectRow;
    private mapProject;
    private mapProjectWithCounts;
    private mapEnv;
    private mapApiKey;
    private mapApiKeyRecord;
}
//# sourceMappingURL=repository.d.ts.map