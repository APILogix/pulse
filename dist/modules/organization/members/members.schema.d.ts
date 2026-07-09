import { z } from "zod";
import type { OrgRole, MemberStatus } from "../shared/types.js";
import type { JoinMethod } from "../types.js";
export declare const MemberParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    userId: z.ZodString;
}, z.core.$strip>;
export declare const UpdateMemberRoleSchema: z.ZodObject<{
    role: z.ZodEnum<{
        security: "security";
        admin: "admin";
        member: "member";
        developer: "developer";
        billing: "billing";
        viewer: "viewer";
    }>;
}, z.core.$strip>;
export declare const MembersListQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        locked: "locked";
        active: "active";
        suspended: "suspended";
        invited: "invited";
        removed: "removed";
    }>>;
    role: z.ZodOptional<z.ZodEnum<{
        security: "security";
        admin: "admin";
        member: "member";
        owner: "owner";
        developer: "developer";
        billing: "billing";
        viewer: "viewer";
    }>>;
}, z.core.$strip>;
export declare const SuspendMemberSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const RemoveMemberSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export interface OrgMemberRow {
    id: string;
    org_id: string;
    user_id: string;
    role: OrgRole;
    status: MemberStatus;
    email: string;
    full_name: string;
    invited_by: string | null;
    invited_at: Date | null;
    joined_at: Date | null;
    joined_method: JoinMethod;
    last_active_at: Date | null;
    deactivated_at: Date | null;
    deactivated_by: string | null;
    deactivation_reason: string | null;
    created_at: Date;
    updated_at: Date;
}
//# sourceMappingURL=members.schema.d.ts.map