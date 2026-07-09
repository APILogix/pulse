import type { SecurityEventsRepository } from "./security-events.repository.js";
import type { SecurityEventDto, CursorPaginationQuery, OrgMemberRow, OrgRole } from "../types.js";
export interface SecurityEventsServiceDependencies {
    repository: SecurityEventsRepository;
    requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
}
export declare class SecurityEventsService {
    private readonly deps;
    constructor(deps: SecurityEventsServiceDependencies);
    listSecurityEvents(orgId: string, userId: string, q: CursorPaginationQuery, filters?: {
        severity?: string;
        eventType?: string;
    }): Promise<{
        data: SecurityEventDto[];
        meta: {
            hasMore: boolean;
            nextCursor: string | null;
            limit: number;
        };
    }>;
}
//# sourceMappingURL=security-events.service.d.ts.map