import type { Pool, PoolClient } from "pg";
import type { ListProjectActivityQuery, ProjectActivityResult } from "./activity.types.js";
export declare class ActivityRepository {
    private readonly db;
    constructor(db?: Pool);
    listProjectActivity(orgId: string, projectId: string, query: ListProjectActivityQuery, client?: PoolClient): Promise<ProjectActivityResult>;
}
//# sourceMappingURL=activity.repository.d.ts.map