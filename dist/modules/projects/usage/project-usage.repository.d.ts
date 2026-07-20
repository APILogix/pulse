/**
 * Project usage repository.
 *
 * Aggregates per-project statistics and usage counters.
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