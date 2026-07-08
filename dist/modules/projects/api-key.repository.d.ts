import type { Pool, PoolClient } from "pg";
import type { ProjectApiKey } from "./types.js";
export declare class ApiKeyRepository {
    private readonly db;
    constructor(db?: Pool);
    create(data: {
        projectId: string;
        organizationId: string;
        name: string;
        keyPrefix: string;
        keyHash: string;
        permissions: string[];
        createdBy: string;
        expiresAt: Date | null;
        status: string;
    }, client?: PoolClient): Promise<ProjectApiKey>;
    findByProjectId(projectId: string, client?: PoolClient): Promise<ProjectApiKey[]>;
    findByPrefix(keyPrefix: string, client?: PoolClient): Promise<ProjectApiKey[]>;
    revoke(id: string, projectId: string, client?: PoolClient): Promise<void>;
    updateLastUsed(id: string, client?: PoolClient): Promise<void>;
    private mapRow;
}
//# sourceMappingURL=api-key.repository.d.ts.map