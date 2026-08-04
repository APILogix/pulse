import type { Pool } from "pg";
import type { AppendRevisionInput, ConfigScope, ConfigStore, HeadRecord, RevisionRecord } from "./sdk-config.service.js";
import type { SchemaV1Config } from "./schema-v1.js";
export declare class PgConfigStore implements ConfigStore {
    private readonly db;
    constructor(db?: Pool);
    private withTx;
    loadCurrent(scope: ConfigScope): Promise<{
        head: HeadRecord;
        current: RevisionRecord;
    } | null>;
    loadRevision(scope: ConfigScope, revisionNo: number): Promise<RevisionRecord | null>;
    appendRevision(scope: ConfigScope, input: AppendRevisionInput): Promise<{
        head: HeadRecord;
        revision: RevisionRecord;
    }>;
    initialize(scope: ConfigScope, revision: RevisionRecord, createdBy: string | null): Promise<{
        head: HeadRecord;
        current: RevisionRecord;
    }>;
    loadCompiledByEnvironment(organizationId: string, environmentId: string): Promise<{
        revisionNo: number;
        compiledSnapshot: SchemaV1Config;
    } | null>;
    loadCompiledBySdkMetadata(organizationId: string, projectId: string, environment: string): Promise<{
        revisionNo: number;
        environmentId: string;
        compiledSnapshot: SchemaV1Config;
    } | null>;
}
//# sourceMappingURL=sdk-config.repository.d.ts.map