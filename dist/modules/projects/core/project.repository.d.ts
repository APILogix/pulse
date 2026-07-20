import type { Pool, PoolClient } from "pg";
import type { ListProjectsQuery, Project, ProjectListItem, ProjectStatus, ProjectUpdateInput, ProjectVisibility } from "../types.js";
type ProjectRow = {
    id: string;
    org_id: string;
    name: string;
    slug: string;
    description: string | null;
    status: ProjectStatus;
    visibility: ProjectVisibility;
    timezone: string;
    tags: string[];
    icon: string | null;
    color: string | null;
    metadata: Record<string, unknown> | null;
    archived_at: Date | null;
    deleted_at: Date | null;
    deleted_by: string | null;
    created_at: Date;
    updated_at: Date;
    version: number;
    api_keys_count?: string | number;
    active_api_keys_count?: string | number;
};
export declare class ProjectRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    listProjects(orgId: string, query: ListProjectsQuery, client?: PoolClient): Promise<{
        projects: ProjectListItem[];
        total: number;
    }>;
    createProject(input: {
        orgId: string;
        name: string;
        slug: string;
        description: string | null;
        visibility?: ProjectVisibility;
        timezone?: string;
        tags?: string[];
        icon?: string | null;
        color?: string | null;
        metadata?: Record<string, unknown>;
        createdBy?: string | null;
    }, client?: PoolClient): Promise<Project>;
    findProjectBySlug(orgId: string, slug: string, client?: PoolClient): Promise<Project | null>;
    findProjectById(orgId: string, projectId: string, client?: PoolClient): Promise<Project | null>;
    findProjectByIdIncludingDeleted(orgId: string, projectId: string, client?: PoolClient): Promise<Project | null>;
    updateProject(orgId: string, projectId: string, input: ProjectUpdateInput, client?: PoolClient): Promise<Project>;
    softDeleteProject(orgId: string, projectId: string, deletedBy: string, client?: PoolClient): Promise<void>;
    restoreProject(orgId: string, projectId: string, client?: PoolClient): Promise<Project>;
    findOrganizationMembership(orgId: string, userId: string, client?: PoolClient): Promise<import("../shared/schema-utils.js").OrganizationMembership | null>;
    getProjectModuleUsageCounts(orgId: string, client?: PoolClient): Promise<{
        projects: number;
        environments: number;
        apiKeys: number;
    }>;
    getProjectStats(projectId: string, client?: PoolClient): Promise<{
        totalRequests: number;
        apiKeysCount: number;
        activeKeysCount: number;
        environmentCount: number;
    }>;
    getProjectUsageCounters(projectId: string, client?: PoolClient): Promise<Array<{
        counterType: string;
        value: number;
        periodStart: Date;
    }>>;
    private buildProjectAssignments;
    private mapProject;
    private mapProjectWithCounts;
}
export type { ProjectRow };
//# sourceMappingURL=project.repository.d.ts.map