import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { SdkConfigChangeType, SdkConfigResolvedDto, SdkConfigRow, SdkConfigVersionRow } from "./sdk-config.types.js";
export interface PublishSdkConfigData {
    configValue: Record<string, unknown>;
    configHash: string;
    schemaVersion: string | null;
    changeType: SdkConfigChangeType;
    changeSummary: string | null;
    rolledBackToRevision?: number | null;
    publishedBy: string;
}
export declare class SdkConfigRepository {
    private readonly db;
    private withTransaction;
    findById(orgId: string, configId: string): Promise<SdkConfigRow | null>;
    list(orgId: string, filters: {
        projectId?: string;
        environmentId?: string;
    }, query: CursorPaginationQuery): Promise<CursorPaginatedResponse<SdkConfigRow>>;
    publish(orgId: string, configId: string, data: PublishSdkConfigData): Promise<SdkConfigRow>;
    listVersions(configId: string): Promise<SdkConfigVersionRow[]>;
    getVersion(configId: string, revision: number): Promise<SdkConfigVersionRow | null>;
    resolveForEnvironment(orgId: string, environmentId: string): Promise<SdkConfigResolvedDto | null>;
}
//# sourceMappingURL=sdk-config.repository.d.ts.map