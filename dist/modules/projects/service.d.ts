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
import type { OrganizationRepository } from "../organization/repository.js";
import { ProjectsRepository } from "./repository.js";
import type { ApiKeyUsage, BulkOperationResult, BulkRevokeBody, BulkRotateBody, CreateApiKeyBody, CreateApiKeyResponse, CreateEnvironmentBody, CreateProjectBody, ListApiKeysQuery, ListProjectActivityQuery, ListProjectsQuery, Project, ProjectActivityResult, ProjectApiKey, ProjectEnvironment, ProjectEnvironmentConfig, ProjectListItem, ProjectUsageCounter, ProjectWithStats, RotateApiKeyBody, UpdateApiKeyBody, UpdateEnvironmentBody, UpdateProjectBody, ValidatedApiKey } from "./types.js";
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
export declare class ProjectsService {
    private readonly repository;
    private readonly logger;
    private readonly orgRepo;
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger, orgRepo: OrganizationRepository);
    listProjects(orgId: string, userId: string, query: ListProjectsQuery): Promise<{
        projects: ProjectListItem[];
        total: number;
        limit: number;
        offset: number;
    }>;
    createProject(orgId: string, userId: string, body: CreateProjectBody, meta: RequestMeta): Promise<Project>;
    getProject(orgId: string, projectId: string, userId: string): Promise<Project>;
    updateProject(orgId: string, projectId: string, userId: string, body: UpdateProjectBody, meta: RequestMeta): Promise<Project>;
    deleteProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<void>;
    restoreProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    archiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    unarchiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    pauseProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    resumeProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    getProjectStats(orgId: string, projectId: string, userId: string): Promise<ProjectWithStats>;
    getProjectUsage(orgId: string, projectId: string, userId: string): Promise<ProjectUsageCounter[]>;
    listProjectActivity(orgId: string, projectId: string, userId: string, query: ListProjectActivityQuery): Promise<ProjectActivityResult>;
    listEnvironments(orgId: string, projectId: string, userId: string): Promise<ProjectEnvironmentConfig[]>;
    getEnvironment(orgId: string, projectId: string, environment: ProjectEnvironment, userId: string): Promise<ProjectEnvironmentConfig>;
    createEnvironment(orgId: string, projectId: string, userId: string, body: CreateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    updateEnvironment(orgId: string, projectId: string, environment: ProjectEnvironment, userId: string, body: UpdateEnvironmentBody, meta: RequestMeta): Promise<ProjectEnvironmentConfig>;
    deleteEnvironment(orgId: string, projectId: string, environment: ProjectEnvironment, userId: string, meta: RequestMeta): Promise<void>;
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
    private requireOrganizationAccess;
    private requireProjectAccess;
    private limitFrom;
    private assertWithinLimit;
    private requireMutableBilling;
    private enforceProjectModuleLimit;
    private assignProjectConfig;
    private generateUniqueSlug;
    private assertFutureExpiry;
    private publicApiKey;
    private summarizeBulk;
    /**
     * Warm the in-process LRU so ingestion resolves the key without a Postgres
     * round trip. Only active keys on active projects are cached as active;
     * ingestion re-validates project status on a miss.
     */
    private warmApiKeyCache;
    private evictApiKeyConfig;
    private evictProjectApiKeys;
    /**
     * Write a project/API-key lifecycle event to the organization audit trail.
     * Non-fatal: a failed audit write never breaks the originating request.
     */
    private audit;
}
//# sourceMappingURL=service.d.ts.map