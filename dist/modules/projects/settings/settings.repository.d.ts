import type { Pool, PoolClient } from "pg";
import type { ProjectSettings } from "../types.js";
export declare class SettingsRepository {
    private readonly db;
    constructor(db?: Pool);
    findByProjectId(projectId: string, client?: PoolClient): Promise<ProjectSettings | null>;
    createDefault(projectId: string, organizationId: string, client?: PoolClient): Promise<ProjectSettings>;
    update(projectId: string, updates: Partial<ProjectSettings>, client?: PoolClient): Promise<ProjectSettings>;
    private mapRow;
}
//# sourceMappingURL=settings.repository.d.ts.map