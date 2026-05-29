/**
 * Project business service.
 *
 * Flow:
 * 1. Validate organization/project access before reads and mutations.
 * 2. Enforce project status transitions and API-key limits.
 * 3. Generate API-key material in memory, persist only hashes/prefixes, and
 *    return the full key once.
 * 4. Populate Redis and LRU caches after API-key creation so ingestion can
 *    resolve new keys without waiting for a cache miss.
 * 5. Write audit records for sensitive project and API-key lifecycle changes.
 */
import type { FastifyBaseLogger } from "fastify";
import { ProjectsRepository } from "./repository.js";
import type { ApiKeyUsage, CreateApiKeyBody, CreateApiKeyResponse, CreateProjectBody, ListApiKeysQuery, ListProjectsQuery, Project, ProjectApiKey, ProjectApiKeyRecord, ProjectListItem, ProjectWithStats, RotateApiKeyBody, UpdateApiKeyBody, UpdateProjectBody } from "./types.js";
type RequestMeta = {
    requestId: string;
    ipAddress: string;
    userAgent: string | null;
};
export declare class ProjectsService {
    private readonly repository;
    private readonly logger;
    constructor(repository: ProjectsRepository, logger: FastifyBaseLogger);
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
    archiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    unarchiveProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    pauseProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    resumeProject(orgId: string, projectId: string, userId: string, meta: RequestMeta): Promise<Project>;
    getProjectStats(orgId: string, projectId: string, userId: string): Promise<ProjectWithStats>;
    listApiKeys(orgId: string, projectId: string, userId: string, query: ListApiKeysQuery): Promise<{
        keys: ProjectApiKey[];
        total: number;
        limit: number;
        offset: number;
    }>;
    createApiKey(orgId: string, projectId: string, userId: string, body: CreateApiKeyBody, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    getApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string): Promise<ProjectApiKey>;
    updateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, body: UpdateApiKeyBody, meta: RequestMeta): Promise<ProjectApiKey>;
    deleteApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<void>;
    rotateApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, body: RotateApiKeyBody, meta: RequestMeta): Promise<CreateApiKeyResponse>;
    enableApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<ProjectApiKey>;
    disableApiKey(orgId: string, projectId: string, apiKeyId: string, userId: string, meta: RequestMeta): Promise<ProjectApiKey>;
    getApiKeyUsage(orgId: string, projectId: string, apiKeyId: string, userId: string): Promise<ApiKeyUsage>;
    validateApiKey(rawKey: string): Promise<ProjectApiKeyRecord | null>;
    private requireOrganizationAccess;
    private requireProjectAccess;
    private generateUniqueSlug;
    private assertFutureExpiry;
    private publicApiKey;
    /**
     * Warm the in-process LRU cache used by ingestion to resolve an API key to
     * its project config without a Postgres round trip. LRU-only (no Redis).
     */
    private cacheApiKeyConfig;
    /**
     * Evict a single API key from the ingestion cache. Called on revoke, rotate,
     * disable, and delete so a revoked secret cannot keep ingesting for the
     * remainder of the LRU TTL window.
     */
    private evictApiKeyConfig;
    /**
     * Evict every cached API key belonging to a project. Called when a project
     * is paused, archived, or deleted so its keys stop resolving as active.
     */
    private evictProjectApiKeys;
    private audit;
}
export {};
//# sourceMappingURL=service.d.ts.map