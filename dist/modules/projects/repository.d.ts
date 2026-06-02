/**
 * Project repository.
 *
 * Flow:
 * 1. Accept service-level identifiers and query options.
 * 2. Execute parameterized SQL against projects, project_api_keys, and
 *    organization membership tables.
 * 3. Map snake_case database rows into camelCase domain objects.
 * 4. Translate expected database conflicts/misses into ProjectError where the
 *    service needs a stable error code.
 */
import type { Pool, PoolClient } from "pg";
import type { ListApiKeysQuery, ListProjectsQuery, OrganizationMembership, Project, ProjectApiKey, ProjectApiKeyRecord, ProjectEnvironment, ProjectListItem, ProjectStatus } from "./types.js";
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
    }, client?: PoolClient): Promise<Project>;
    findProjectBySlug(orgId: string, slug: string, client?: PoolClient): Promise<Project | null>;
    findProjectById(orgId: string, projectId: string, client?: PoolClient): Promise<Project | null>;
    updateProject(orgId: string, projectId: string, input: {
        name?: string;
        description?: string | null;
        status?: ProjectStatus;
        environment?: ProjectEnvironment;
        productionApiPrefix?: string | null;
        developmentApiPrefix?: string | null;
    }, client?: PoolClient): Promise<Project>;
    deleteProject(orgId: string, projectId: string, client?: PoolClient): Promise<void>;
    getProjectStats(projectId: string, client?: PoolClient): Promise<{
        apiKeysCount: number;
        activeKeysCount: number;
    }>;
    listApiKeys(projectId: string, query: ListApiKeysQuery, client?: PoolClient): Promise<{
        keys: ProjectApiKey[];
        total: number;
    }>;
    createApiKey(input: {
        projectId: string;
        keyHash: string;
        keyPrefix: string;
        environment: ProjectEnvironment;
        name: string | null;
        createdBy: string;
        expiresAt: Date | null;
    }, client?: PoolClient): Promise<ProjectApiKeyRecord>;
    countActiveApiKeys(projectId: string, environment: ProjectEnvironment, client?: PoolClient): Promise<number>;
    findApiKeyById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKey | null>;
    findApiKeyRecordById(projectId: string, apiKeyId: string, client?: PoolClient): Promise<ProjectApiKeyRecord | null>;
    updateApiKey(projectId: string, apiKeyId: string, input: {
        name?: string | null;
        expiresAt?: Date | null;
    }, client?: PoolClient): Promise<ProjectApiKey>;
    setApiKeyActiveState(projectId: string, apiKeyId: string, isActive: boolean, client?: PoolClient): Promise<ProjectApiKey>;
    deleteApiKey(projectId: string, apiKeyId: string, client?: PoolClient): Promise<void>;
    touchApiKeyLastUsed(apiKeyId: string, client?: PoolClient): Promise<void>;
    /**
     * Return the key hashes for every API key of a project. Used by the service
     * to evict the in-process ingestion cache when a project is paused, archived,
     * or deleted so stale keys stop resolving as active.
     */
    listApiKeyHashesByProject(projectId: string, client?: PoolClient): Promise<string[]>;
    findActiveApiKeyCandidatesByPrefix(keyPrefix: string, client?: PoolClient): Promise<Array<{
        apiKey: ProjectApiKeyRecord;
        project: Project;
    }>>;
    private mapProject;
    private mapProjectWithCounts;
    private mapApiKey;
    private mapApiKeyRecord;
}
//# sourceMappingURL=repository.d.ts.map