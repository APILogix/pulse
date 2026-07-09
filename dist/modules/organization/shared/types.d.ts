import { z } from "zod";
export declare const OrgStatusSchema: z.ZodEnum<{
    locked: "locked";
    active: "active";
    suspended: "suspended";
    trialing: "trialing";
    archived: "archived";
    delinquent: "delinquent";
}>;
export declare const MemberStatusSchema: z.ZodEnum<{
    locked: "locked";
    active: "active";
    suspended: "suspended";
    invited: "invited";
    removed: "removed";
}>;
export declare const OrgRoleSchema: z.ZodEnum<{
    security: "security";
    admin: "admin";
    member: "member";
    owner: "owner";
    developer: "developer";
    billing: "billing";
    viewer: "viewer";
}>;
export type OrgStatus = z.infer<typeof OrgStatusSchema>;
export type MemberStatus = z.infer<typeof MemberStatusSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export declare const ROLE_HIERARCHY: Record<OrgRole, number>;
/** Check if a user role meets or exceeds the required role level. */
export declare function hasMinRole(userRole: OrgRole, requiredRole: OrgRole): boolean;
/** Check if an actor can manage (modify role of) a target user. */
export declare function canManageRole(actorRole: OrgRole, targetRole: OrgRole): boolean;
export declare function isMutableOrg(status: OrgStatus): boolean;
export declare function isReadableOrg(status: OrgStatus): boolean;
export declare const UuidSchema: z.ZodString;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const IdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const CursorPaginationSchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>;
export type CursorPaginationQuery = z.infer<typeof CursorPaginationSchema>;
export interface CursorPaginatedResponse<T> {
    data: T[];
    meta: {
        hasMore: boolean;
        nextCursor: string | null;
        limit: number;
    };
}
export interface RequestMeta {
    actorUserId: string;
    actorEmail: string;
    actorSessionId: string;
    actorIp: string;
    actorUserAgent: string | null;
    httpMethod: string;
    endpoint: string;
    requestId: string;
}
//# sourceMappingURL=types.d.ts.map