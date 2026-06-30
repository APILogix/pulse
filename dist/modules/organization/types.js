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
export const InvitationStatusSchema = z.enum([
    "pending",
    "accepted",
    "declined",
    "revoked",
    "expired",
]);
export const JoinMethodSchema = z.enum([
    "invite",
    "admin_add",
    "sso_auto_provision",
    "scim",
]);
export const QuotaRequestStatusSchema = z.enum([
    "pending",
    "approved",
    "rejected",
    "cancelled",
]);
export const QuotaTypeSchema = z.enum([
    "api_requests",
    "events",
    "storage",
    "projects",
    "members",
    "alerts",
]);
export const SecurityEventSeveritySchema = z.enum([
    "low",
    "medium",
    "high",
    "critical",
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
export const MemberParamsSchema = z.object({ orgId: UuidSchema, userId: UuidSchema });
export const InvitationIdParamsSchema = z.object({ orgId: UuidSchema, invitationId: UuidSchema });
export const InvitationParamsSchema = z.object({ id: UuidSchema });
export const EnvironmentParamsSchema = z.object({ orgId: UuidSchema, envId: UuidSchema });
export const ApiKeyParamsSchema = z.object({ orgId: UuidSchema, keyId: UuidSchema });
export const SsoProviderParamsSchema = z.object({ orgId: UuidSchema, ssoId: UuidSchema });
export const ScimTokenParamsSchema = z.object({ orgId: UuidSchema, tokenId: UuidSchema });
export const QuotaRequestParamsSchema = z.object({ orgId: UuidSchema, requestId: UuidSchema });
export const SlugParamsSchema = z.object({ slug: z.string().min(1).max(255) });
export const GlobalInvitationParamsSchema = z.object({ id: UuidSchema });
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
// ═══════════════════════════════════════════════════
// ORGANIZATION SCHEMAS
// ═══════════════════════════════════════════════════
export const CreateOrganizationSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    description: z.string().max(1000).optional(),
    industry: z.string().max(100).optional(),
    companySize: z.string().max(50).optional(),
    country: z.string().max(100).optional(),
    timezone: z.string().max(100).default("UTC"),
    billingEmail: z.string().email().optional(),
});
export const UpdateOrganizationSchema = z.object({
    name: z.string().min(1).max(255).trim().optional(),
    description: z.string().max(1000).nullable().optional(),
    logoUrl: z.string().url().nullable().optional(),
    websiteUrl: z.string().url().nullable().optional(),
    industry: z.string().max(100).nullable().optional(),
    companySize: z.string().max(50).nullable().optional(),
    country: z.string().max(100).nullable().optional(),
    timezone: z.string().max(100).optional(),
    billingEmail: z.string().email().optional(),
    supportEmail: z.string().email().nullable().optional(),
});
export const TransferOwnershipSchema = z.object({
    newOwnerUserId: UuidSchema,
});
// ═══════════════════════════════════════════════════
// SETTINGS SCHEMAS
// ═══════════════════════════════════════════════════
export const UpdateSettingsSchema = z.object({
    enforceSso: z.boolean().optional(),
    enforceMfa: z.boolean().optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
    dataRegion: z.enum(["us-east-1", "eu-west-1", "ap-south-1"]).optional(),
    dataRetentionDays: z.number().int().min(1).max(3650).optional(),
    auditLogRetentionDays: z.number().int().min(30).max(3650).optional(),
    allowPublicProjects: z.boolean().optional(),
});
// ═══════════════════════════════════════════════════
// MEMBER SCHEMAS
// ═══════════════════════════════════════════════════
export const UpdateMemberRoleSchema = z.object({
    role: OrgRoleSchema.exclude(["owner"]),
});
export const MembersListQuerySchema = CursorPaginationSchema.extend({
    status: MemberStatusSchema.optional(),
    role: OrgRoleSchema.optional(),
});
export const SuspendMemberSchema = z.object({
    reason: z.string().max(500).optional(),
});
export const RemoveMemberSchema = z.object({
    reason: z.string().max(500).optional(),
});
// ═══════════════════════════════════════════════════
// INVITATION SCHEMAS
// ═══════════════════════════════════════════════════
export const CreateInvitationSchema = z.object({
    email: z.string().email(),
    role: OrgRoleSchema.exclude(["owner"]).default("member"),
});
export const AcceptInvitationSchema = z.object({
    token: z.string().length(64),
});
export const InvitationValidateQuerySchema = z.object({
    token: z.string().length(64),
});
export const InvitationListQuerySchema = CursorPaginationSchema.extend({
    status: InvitationStatusSchema.optional(),
});
// ═══════════════════════════════════════════════════
// ENVIRONMENT SCHEMAS
// ═══════════════════════════════════════════════════
export const CreateEnvironmentSchema = z.object({
    name: z.string().min(1).max(100).trim(),
    description: z.string().max(500).optional(),
    isProduction: z.boolean().default(false),
});
export const UpdateEnvironmentSchema = z.object({
    name: z.string().min(1).max(100).trim().optional(),
    description: z.string().max(500).nullable().optional(),
    isProduction: z.boolean().optional(),
});
// ═══════════════════════════════════════════════════
// API KEY SCHEMAS
// ═══════════════════════════════════════════════════
export const CreateApiKeySchema = z.object({
    name: z.string().min(1).max(255).trim(),
    environmentId: UuidSchema.optional(),
    role: OrgRoleSchema.exclude(["owner"]).default("member"),
    expiresInDays: z.number().int().min(1).max(365).optional(),
});
// ═══════════════════════════════════════════════════
// SSO SCHEMAS
// ═══════════════════════════════════════════════════
export const CreateSsoProviderSchema = z.object({
    providerName: z.string().min(1).max(100),
    providerType: z.enum(["saml", "oidc"]),
    entityId: z.string().optional(),
    ssoUrl: z.string().url().optional(),
    x509Certificate: z.string().optional(),
    domain: z.string().max(255).optional(),
});
export const UpdateSsoProviderSchema = z.object({
    providerName: z.string().min(1).max(100).optional(),
    entityId: z.string().optional(),
    ssoUrl: z.string().url().optional(),
    x509Certificate: z.string().optional(),
    domain: z.string().max(255).optional(),
    isActive: z.boolean().optional(),
});
// ═══════════════════════════════════════════════════
// QUOTA SCHEMAS
// ═══════════════════════════════════════════════════
export const CreateQuotaRequestSchema = z.object({
    quotaType: z.string().min(1).max(50),
    currentLimit: z.number().int().min(0),
    requestedLimit: z.number().int().min(1),
    reason: z.string().min(1).max(2000),
});
export const ReviewQuotaRequestSchema = z.object({
    notes: z.string().max(2000).optional(),
});
// ═══════════════════════════════════════════════════
// ALERT THRESHOLD SCHEMAS — latency/error/apdex SLO gates per org/project
// ═══════════════════════════════════════════════════
/** Query for resolving which scope to read/write (org-wide vs project). */
export const AlertThresholdQuerySchema = z.object({
    projectId: UuidSchema.optional(),
});
export const UpsertAlertThresholdSchema = z.object({
    projectId: UuidSchema.nullable().optional(),
    p50ThresholdMs: z.number().int().min(1).max(600000).optional(),
    p75ThresholdMs: z.number().int().min(1).max(600000).optional(),
    p90ThresholdMs: z.number().int().min(1).max(600000).optional(),
    p95ThresholdMs: z.number().int().min(1).max(600000).optional(),
    p99ThresholdMs: z.number().int().min(1).max(600000).optional(),
    p50AlertEnabled: z.boolean().optional(),
    p75AlertEnabled: z.boolean().optional(),
    p90AlertEnabled: z.boolean().optional(),
    p95AlertEnabled: z.boolean().optional(),
    p99AlertEnabled: z.boolean().optional(),
    errorRateThresholdPercent: z.number().min(0).max(100).optional(),
    errorRateAlertEnabled: z.boolean().optional(),
    apdexThreshold: z.number().min(0).max(1).optional(),
    apdexAlertEnabled: z.boolean().optional(),
    evaluationWindowMinutes: z.number().int().min(1).max(1440).optional(),
    cooldownMinutes: z.number().int().min(0).max(1440).optional(),
    alertsEnabled: z.boolean().optional(),
    notifyEmails: z.array(z.string().email()).max(50).optional(),
});
// ═══════════════════════════════════════════════════
// AUDIT LOG QUERY SCHEMAS
// ═══════════════════════════════════════════════════
export const AuditLogQuerySchema = CursorPaginationSchema.extend({
    action: z.string().max(100).optional(),
    entityType: z.string().max(100).optional(),
    actorUserId: UuidSchema.optional(),
});
export const SecurityEventsQuerySchema = CursorPaginationSchema.extend({
    severity: SecurityEventSeveritySchema.optional(),
    eventType: z.string().max(100).optional(),
});
// ═══════════════════════════════════════════════════
// ERROR CLASSES
// ═══════════════════════════════════════════════════
export class OrganizationError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode = 400) {
        super(message);
        this.code = code;
        this.name = "OrganizationError";
        this.statusCode = statusCode;
    }
}
export class ConflictError extends OrganizationError {
    constructor(message) {
        super(message, "CONFLICT", 409);
    }
}
export class NotFoundError extends OrganizationError {
    constructor(resource) {
        super(`${resource} not found`, "NOT_FOUND", 404);
    }
}
export class ForbiddenError extends OrganizationError {
    constructor(message = "Access denied") {
        super(message, "FORBIDDEN", 403);
    }
}
export class ValidationError extends OrganizationError {
    constructor(message) {
        super(message, "VALIDATION_ERROR", 422);
    }
}
export class OrgStatusError extends OrganizationError {
    constructor(status) {
        super(`Organization is ${status}. This action is not permitted.`, "ORG_STATUS_INVALID", 403);
    }
}
//# sourceMappingURL=types.js.map