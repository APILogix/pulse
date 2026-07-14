import { z } from "zod";
import type { OrgRole } from "../shared/types.js";
export declare const InvitationStatusSchema: z.ZodEnum<{
    expired: "expired";
    revoked: "revoked";
    pending: "pending";
    accepted: "accepted";
    declined: "declined";
}>;
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;
export declare const InvitationIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    invitationId: z.ZodString;
}, z.core.$strip>;
export declare const InvitationParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const GlobalInvitationParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const CreateInvitationSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        security: "security";
        admin: "admin";
        member: "member";
        developer: "developer";
        billing: "billing";
        viewer: "viewer";
    }>>;
}, z.core.$strip>;
export declare const AcceptInvitationSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export declare const InvitationValidateQuerySchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export declare const InvitationListQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        expired: "expired";
        revoked: "revoked";
        pending: "pending";
        accepted: "accepted";
        declined: "declined";
    }>>;
}, z.core.$strip>;
export interface OrgInvitationRow {
    id: string;
    org_id: string;
    invited_by: string;
    invited_by_email: string | null;
    invited_by_name: string | null;
    email: string;
    role: OrgRole;
    token_hash: string;
    expires_at: Date;
    status: InvitationStatus;
    accepted_at: Date | null;
    accepted_by: string | null;
    declined_at: Date | null;
    revoked_at: Date | null;
    revoked_by: string | null;
    resent_count: number;
    last_resent_at: Date | null;
    created_at: Date;
}
//# sourceMappingURL=invitations.schema.d.ts.map