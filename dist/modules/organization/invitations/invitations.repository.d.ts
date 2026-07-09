import { BaseRepository } from "../shared/base.repository.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { OrgInvitationRow } from "./invitations.schema.js";
export declare class InvitationsRepository extends BaseRepository {
    createInvitation(orgId: string, invitedBy: string, email: string, role: string, tokenHash: string, expiresAt: Date): Promise<OrgInvitationRow>;
    findInvitationById(id: string): Promise<OrgInvitationRow | null>;
    findInvitationByTokenHash(hash: string): Promise<(OrgInvitationRow & {
        email_hash?: string;
    }) | null>;
    listInvitations(orgId: string, q: CursorPaginationQuery, status?: string): Promise<CursorPaginatedResponse<OrgInvitationRow>>;
    acceptInvitation(tokenHash: string, userId: string): Promise<void>;
    acceptInvitationAndAddMember(tokenHash: string, userId: string, maxActiveMembers: number | null): Promise<void>;
    declineInvitation(id: string, _userId: string): Promise<void>;
    revokeInvitation(id: string, by: string): Promise<void>;
    incrementResentCount(id: string): Promise<void>;
    rotateInvitationToken(id: string, tokenHash: string): Promise<void>;
    expireStalePendingInvitations(): Promise<number>;
    purgeTerminalInvitations(days: number): Promise<number>;
    findInvitationByOrgAndId(orgId: string, invitationId: string): Promise<OrgInvitationRow | null>;
    findOrgNameAndSlug(orgId: string): Promise<{
        name: string;
        slug: string;
    } | null>;
    findUserByEmail(email: string): Promise<{
        id: string;
        email: string;
        full_name: string;
    } | null>;
}
//# sourceMappingURL=invitations.repository.d.ts.map