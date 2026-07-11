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
import type { ListProjectsQuery, OrganizationMembership, Project, ProjectEnvironment, ProjectListItem, ProjectUsageCounter, ProjectUpdateInput } from "./types.js";
export interface ProjectModuleUsageCounts {
    projects: number;
    environments: number;
    apiKeys: number;
}
export declare class ProjectsRepository {
    private readonly db;
    private readonly core;
    private readonly members;
    private readonly usage;
    private readonly settings;
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
    getProjectModuleUsageCounts(orgId: string, client?: PoolClient): Promise<ProjectModuleUsageCounts>;
    findSdkConfigPlanKey(orgId: string, client?: PoolClient): Promise<string>;
    createDefaultSdkConfigs(project: Project, createdBy: string, planKey: string, client?: PoolClient): Promise<number>;
}
export * from "./core/project.repository.js";
export * from "./members/member.repository.js";
export * from "./usage/project-usage.repository.js";
export * from "./settings/project-settings.repository.js";
//# sourceMappingURL=repository.d.ts.map