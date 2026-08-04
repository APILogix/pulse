import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { SdkConfigResolvedDto, SdkConfigRow, SdkConfigVersionRow } from "./sdk-config.types.js";
/** Read-only admin projection. All mutations go through RemoteSdkConfigService. */
export declare class SdkConfigRepository {
    private readonly db;
    findById(orgId: string, configId: string): Promise<SdkConfigRow | null>;
    list(orgId: string, filters: {
        projectId?: string;
        environmentId?: string;
    }, query: CursorPaginationQuery): Promise<CursorPaginatedResponse<SdkConfigRow>>;
    listVersions(configId: string): Promise<SdkConfigVersionRow[]>;
    getVersion(configId: string, revision: number): Promise<SdkConfigVersionRow | null>;
    resolveForEnvironment(orgId: string, environmentId: string): Promise<SdkConfigResolvedDto | null>;
}
//# sourceMappingURL=sdk-config.repository.d.ts.map