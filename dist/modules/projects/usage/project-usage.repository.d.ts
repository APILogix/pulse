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
import type { ProjectUsageCounter } from "../types.js";
export interface ProjectModuleUsageCounts {
    projects: number;
    environments: number;
    apiKeys: number;
}
export declare class ProjectUsageRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    getProjectStats(projectId: string, client?: PoolClient): Promise<{
        totalRequests: number;
        apiKeysCount: number;
        activeKeysCount: number;
        environmentCount: number;
    }>;
    getProjectUsageCounters(projectId: string, client?: PoolClient): Promise<ProjectUsageCounter[]>;
    getProjectModuleUsageCounts(orgId: string, client?: PoolClient): Promise<ProjectModuleUsageCounts>;
}
//# sourceMappingURL=project-usage.repository.d.ts.map