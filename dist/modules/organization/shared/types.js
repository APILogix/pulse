import { z } from "zod";
// ═══════════════════════════════════════════════════
// ENUMS — Match PostgreSQL enum types exactly
// ═══════════════════════════════════════════════════
export const OrgStatusSchema = z.enum([
    "active",
    "trialing",
    "suspended",
    "locked",
    "archived",
    "delinquent",
]);
export const MemberStatusSchema = z.enum([
    "invited",
    "active",
    "suspended",
    "removed",
    "locked",
]);
export const OrgRoleSchema = z.enum([
    "owner",
    "admin",
    "developer",
    "billing",
    "security",
    "member",
    "viewer",
]);
// ═══════════════════════════════════════════════════
// ROLE HIERARCHY — owner > admin > developer > security = billing > member > viewer
// ═══════════════════════════════════════════════════
export const ROLE_HIERARCHY = {
    owner: 100,
    admin: 80,
    developer: 60,
    security: 50,
    billing: 50,
    member: 40,
    viewer: 20,
};
/** Check if a user role meets or exceeds the required role level. */
export function hasMinRole(userRole, requiredRole) {
    return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}
/** Check if an actor can manage (modify role of) a target user. */
export function canManageRole(actorRole, targetRole) {
    return (ROLE_HIERARCHY[actorRole] ?? 0) > (ROLE_HIERARCHY[targetRole] ?? 0);
}
// ═══════════════════════════════════════════════════
// ORG STATUS GATES — prevent mutations on inactive orgs
// ═══════════════════════════════════════════════════
const MUTABLE_STATUSES = new Set(["active", "trialing"]);
const READABLE_STATUSES = new Set([
    "active",
    "trialing",
    "suspended",
    "locked",
    "archived",
    "delinquent",
]);
export function isMutableOrg(status) {
    return MUTABLE_STATUSES.has(status);
}
export function isReadableOrg(status) {
    return READABLE_STATUSES.has(status);
}
// ═══════════════════════════════════════════════════
// COMMON PARAM SCHEMAS
// ═══════════════════════════════════════════════════
export const UuidSchema = z.string().uuid();
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema });
export const IdParamsSchema = z.object({ id: UuidSchema });
// ═══════════════════════════════════════════════════
// CURSOR PAGINATION
// ═══════════════════════════════════════════════════
export const CursorPaginationSchema = z.object({
    cursor: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(255).optional(),
    sortBy: z.string().max(50).optional(),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});
//# sourceMappingURL=types.js.map