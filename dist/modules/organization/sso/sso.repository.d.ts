import { BaseRepository } from "../shared/base.repository.js";
import type { OrgSsoProviderRow } from "./sso.schema.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
export declare class SsoRepository extends BaseRepository {
    createSsoProvider(orgId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow>;
    listSsoProviders(orgId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<OrgSsoProviderRow>>;
    updateSsoProvider(orgId: string, ssoId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow>;
    deleteSsoProvider(orgId: string, ssoId: string): Promise<void>;
}
//# sourceMappingURL=sso.repository.d.ts.map