/**
 * Project settings repository.
 *
 * Provides SDK config provisioning and plan-key lookups for projects.
 */
import type { Pool, PoolClient } from "pg";
import type { Project } from "../types.js";
export declare class ProjectSettingsRepository {
    private readonly db;
    constructor(db?: Pool);
    withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T>;
    findSdkConfigPlanKey(orgId: string, client?: PoolClient): Promise<string>;
    createDefaultSdkConfigs(project: Project, createdBy: string, planKey: string, client?: PoolClient): Promise<number>;
}
//# sourceMappingURL=project-settings.repository.d.ts.map