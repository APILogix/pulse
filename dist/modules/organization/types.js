import { z } from "zod";
import { OrgStatusSchema, MemberStatusSchema, OrgRoleSchema, UuidSchema, OrgIdParamsSchema, IdParamsSchema, CursorPaginationSchema, } from "./shared/types.js";
export * from "./shared/types.js";
// ═══════════════════════════════════════════════════
// ENUMS — Match PostgreSQL enum types exactly
// ═══════════════════════════════════════════════════
// (exported via shared/types.js)
export const JoinMethodSchema = z.enum([
    "invite",
    "admin_add",
    "sso_auto_provision",
    "scim",
]);
export { QuotaRequestStatusSchema, QuotaTypeSchema } from "./quotas/quotas.schema.js";
export const SecurityEventSeveritySchema = z.enum([
    "low",
    "medium",
    "high",
    "critical",
]);
// (exported via shared/types.js)
// ═══════════════════════════════════════════════════
// COMMON PARAM SCHEMAS
// ═══════════════════════════════════════════════════
// (exported via shared/types.js)
// (exported via shared/types.js)
// ═══════════════════════════════════════════════════
// ORGANIZATION SCHEMAS
// ═══════════════════════════════════════════════════
export { SwitchOrganizationSchema, SlugParamsSchema, CreateOrganizationSchema, UpdateOrganizationSchema, TransferOwnershipSchema, UpdateSettingsSchema } from "./core/core.schema.js";
export { MemberParamsSchema } from "./members/members.schema.js";
export const SsoProviderParamsSchema = z.object({ orgId: UuidSchema, ssoId: UuidSchema });
export const ScimTokenParamsSchema = z.object({ orgId: UuidSchema, tokenId: UuidSchema });
export const ScimTokenIpSchema = z.string().trim().min(1).max(64);
export const QuotaRequestParamsSchema = z.object({ orgId: UuidSchema, requestId: UuidSchema });
// ═══════════════════════════════════════════════════
// MEMBER SCHEMAS
// ═══════════════════════════════════════════════════
export { UpdateMemberRoleSchema, MembersListQuerySchema, SuspendMemberSchema, RemoveMemberSchema } from "./members/members.schema.js";
// ═══════════════════════════════════════════════════
// INVITATION SCHEMAS
// ═══════════════════════════════════════════════════
export { InvitationStatusSchema, InvitationIdParamsSchema, InvitationParamsSchema, GlobalInvitationParamsSchema, CreateInvitationSchema, AcceptInvitationSchema, InvitationValidateQuerySchema, InvitationListQuerySchema } from "./invitations/invitations.schema.js";
// ═══════════════════════════════════════════════════
// SSO SCHEMAS
// ═══════════════════════════════════════════════════
export { CreateSsoProviderSchema, UpdateSsoProviderSchema } from "./sso/sso.schema.js";
export const ScimScopeSchema = z.enum(["users:read", "users:write", "users:delete", "groups:read", "groups:write", "groups:delete", "bulk"]);
export const CreateScimTokenSchema = z.object({
    scopes: z.array(ScimScopeSchema).min(1).default(["users:read", "users:write", "users:delete", "groups:read", "groups:write", "groups:delete"]),
    allowedIps: z.array(ScimTokenIpSchema).max(32).optional(),
    expiresInDays: z.coerce.number().int().min(1).max(3650).optional(),
});
// ═══════════════════════════════════════════════════
// QUOTA SCHEMAS
// ═══════════════════════════════════════════════════
export { CreateQuotaRequestSchema, ReviewQuotaRequestSchema } from "./quotas/quotas.schema.js";
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
export { AuditLogQuerySchema } from "./audit-logs/audit-logs.schema.js";
export const SecurityEventsQuerySchema = CursorPaginationSchema.extend({
    severity: SecurityEventSeveritySchema.optional(),
    eventType: z.string().max(100).optional(),
});
// ═══════════════════════════════════════════════════
// ERROR CLASSES
// ═══════════════════════════════════════════════════
export { OrganizationError, ConflictError, NotFoundError, ForbiddenError, ValidationError, OrgStatusError, } from "./shared/errors.js";
//# sourceMappingURL=types.js.map