import type { Pool, PoolClient } from "pg";
import { EnvironmentType, type ProjectEnvironmentConfig } from "./environment.types.js";
export type EnvRow = {
    id: string;
    project_id: string;
    organization_id: string;
    name: string;
    slug: string;
    type: EnvironmentType;
    description: string | null;
    color: string;
    is_default: boolean;
    is_active: boolean;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
};
type EnvironmentWrite = {
    name?: string | undefined;
    slug?: string | undefined;
    type?: EnvironmentType | undefined;
    description?: string | null | undefined;
    color?: string | undefined;
    isDefault?: boolean | undefined;
    isActive?: boolean | undefined;
};
export declare class EnvironmentRepository {
    private readonly db;
    constructor(db?: Pool);
    private transaction;
    private translateConflict;
    listEnvironments(projectId: string, includeDeleted?: boolean, client?: PoolClient): Promise<ProjectEnvironmentConfig[]>;
    findEnvironment(projectId: string, environmentId: string, client?: PoolClient): Promise<ProjectEnvironmentConfig | null>;
    findEnvironmentIncludingDeleted(projectId: string, environmentId: string, client?: PoolClient, forUpdate?: boolean): Promise<ProjectEnvironmentConfig | null>;
    createEnvironment(input: EnvironmentWrite & {
        projectId: string;
        orgId: string;
        name: string;
        slug: string;
        type: EnvironmentType;
        color: string;
    }, client?: PoolClient): Promise<ProjectEnvironmentConfig>;
    updateEnvironment(projectId: string, environmentId: string, input: EnvironmentWrite, client?: PoolClient): Promise<ProjectEnvironmentConfig>;
    private assertCanDeactivate;
    setDefaultEnvironment(projectId: string, environmentId: string, client?: PoolClient): Promise<ProjectEnvironmentConfig>;
    deactivateEnvironment(projectId: string, environmentId: string, client?: PoolClient): Promise<ProjectEnvironmentConfig>;
    deleteEnvironment(projectId: string, environmentId: string, client?: PoolClient): Promise<void>;
    /**
     * Hard-delete an already soft-deleted environment along with every API key
     * scoped to it (and their rotation history) plus its SDK configuration
     * (head + immutable revisions cascade via FK). Requires the environment to
     * already be soft-deleted so the destructive purge is always a deliberate
     * second step after the reversible delete, never the default action.
     *
     * `project_api_keys`/`project_api_key_rotations`/`project_releases` all hold
     * an `ON DELETE RESTRICT` foreign key to `project_environments`, so they are
     * removed explicitly before the environment row itself is deleted. SDK
     * config tables and nullable-environment alert thresholds hold `ON DELETE
     * CASCADE` and are removed automatically by Postgres.
     */
    permanentlyDeleteEnvironment(projectId: string, environmentId: string, client?: PoolClient): Promise<{
        deletedApiKeySecretHashes: string[];
        deletedActiveApiKeyCount: number;
    }>;
    restoreEnvironment(projectId: string, environmentId: string, client?: PoolClient): Promise<ProjectEnvironmentConfig>;
    mapEnv(row: EnvRow): ProjectEnvironmentConfig;
}
export {};
//# sourceMappingURL=environment.repository.d.ts.map