import { BaseRepository } from "../shared/base.repository.js";
import type { SecurityEventRow, CursorPaginationQuery, CursorPaginatedResponse } from "../types.js";
export declare class SecurityEventsRepository extends BaseRepository {
    listSecurityEvents(orgId: string, q: CursorPaginationQuery, filters?: {
        severity?: string;
        eventType?: string;
    }): Promise<CursorPaginatedResponse<SecurityEventRow>>;
}
//# sourceMappingURL=security-events.repository.d.ts.map