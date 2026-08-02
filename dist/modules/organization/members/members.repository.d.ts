import { BaseRepository } from "../shared/base.repository.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { OrgMemberRow } from "./members.schema.js";
export declare class MembersRepository extends BaseRepository {
    findActiveMember(orgId: string, userId: string): Promise<OrgMemberRow | null>;
    findMember(orgId: string, userId: string): Promise<OrgMemberRow | null>;
    getMemberRole(orgId: string, userId: string): Promise<string | null>;
    listMembers(orgId: string, q: CursorPaginationQuery, filters?: {
        status?: string;
        role?: string;
    }): Promise<CursorPaginatedResponse<OrgMemberRow>>;
    addMember(orgId: string, userId: string, role: string, invitedBy: string, method: string): Promise<OrgMemberRow>;
    removeMember(orgId: string, userId: string, by: string, reason?: string): Promise<void>;
    suspendMember(orgId: string, userId: string, by: string, reason?: string): Promise<void>;
    reactivateMember(orgId: string, userId: string): Promise<void>;
    updateMemberRole(orgId: string, userId: string, role: string): Promise<void>;
    countActiveOwners(orgId: string): Promise<number>;
}
//# sourceMappingURL=members.repository.d.ts.map