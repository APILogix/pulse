import { z } from "zod";
export const OrgStatusSchema = z.enum([
    "active",
    "suspended",
    "cancelled",
    "trial_expired",
]);
export const SubscriptionStatusSchema = z.enum([
    "trialing",
    "active",
    "past_due",
    "canceled",
    "unpaid",
    "paused",
]);
export const OrgRoleSchema = z.enum(["admin", "member"]);
export const JoinMethodSchema = z.enum([
    "invite",
    "sso_auto_provision",
    "admin_add",
    "self_created",
]);
export const AuditActionSchema = z.enum([
    "user.created",
    "user.updated",
    "user.deleted",
    "user.login",
    "user.logout",
    "user.password_changed",
    "user.mfa_enabled",
    "user.mfa_disabled",
    "org.created",
    "org.updated",
    "org.deleted",
    "org.member_invited",
    "org.member_joined",
    "org.member_removed",
    "org.role_changed",
    "project.created",
    "project.updated",
    "project.deleted",
    "project.api_key_created",
    "project.api_key_revoked",
    "alert_rule.created",
    "alert_rule.updated",
    "alert_rule.deleted",
    "alert_rule.triggered",
    "billing.subscription_created",
    "billing.subscription_cancelled",
    "billing.payment_succeeded",
    "billing.payment_failed",
    "security.suspicious_login_blocked",
    "security.mfa_challenge_failed",
    "security.token_revoked",
    "security.session_terminated",
    "data.export_requested",
    "data.deletion_requested",
    "data.deletion_completed",
    "admin.impersonation_started",
    "admin.impersonation_ended",
    "admin.force_password_reset",
]);
export const AuditResourceTypeSchema = z.enum([
    "user",
    "organization",
    "project",
    "api_key",
    "alert_rule",
    "subscription",
    "invoice",
    "session",
    "audit_log",
]);
export const UuidSchema = z.string().uuid();
export const BillingAddressSchema = z.object({
    street: z.string().max(255),
    city: z.string().max(100),
    state: z.string().max(100).optional(),
    zip: z.string().max(20),
    country: z.string().length(2),
    vatId: z.string().max(100).optional(),
});
const ipv4Regex = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([0-9]|[12][0-9]|3[0-2]))?$/;
export const IdParamsSchema = z.object({ id: UuidSchema });
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema });
export const MemberParamsSchema = z.object({
    orgId: UuidSchema,
    userId: UuidSchema,
});
export const InvitationParamsSchema = z.object({ id: UuidSchema });
export const SlugParamsSchema = z.object({ slug: z.string().min(1).max(255) });
export const PaginationQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
export const AuditQuerySchema = PaginationQuerySchema;
export const InvitationListQuerySchema = PaginationQuerySchema.extend({
    status: z.enum(["pending", "accepted", "declined", "revoked"]).optional(),
});
export const InvitationValidateQuerySchema = z.object({
    token: z.string().length(64),
});
export const CreateOrganizationSchema = z.object({
    name: z.string().min(1).max(255),
});
export const UpdateOrganizationSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).nullable().optional(),
    websiteUrl: z.string().url().nullable().optional(),
    billingEmail: z.string().email().optional(),
    billingName: z.string().max(255).nullable().optional(),
    billingAddress: BillingAddressSchema.nullable().optional(),
    dataRegion: z.enum(["us-east-1", "eu-west-1", "ap-south-1"]).optional(),
    enforceSso: z.boolean().optional(),
    enforceMfa: z.boolean().optional(),
    allowedEmailDomains: z.array(z.string()).nullable().optional(),
    ipAllowlist: z
        .array(z.string().regex(ipv4Regex, "Invalid IPv4 or CIDR"))
        .nullable()
        .optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).optional(),
    dataRetentionDays: z.number().int().min(1).optional(),
});
export const UpdateBillingSchema = z.object({
    billingEmail: z.string().email(),
    billingName: z.string().max(255).nullable().optional(),
    billingAddress: BillingAddressSchema,
});
export const UpdateSecuritySchema = z.object({
    enforceSso: z.boolean(),
    enforceMfa: z.boolean(),
    allowedEmailDomains: z.array(z.string()).nullable().optional(),
    ipAllowlist: z
        .array(z.string().regex(ipv4Regex, "Invalid IPv4 or CIDR"))
        .nullable()
        .optional(),
    sessionTimeoutMinutes: z.number().int().min(5).max(1440).default(480),
});
export const UpgradePlanSchema = z.object({
    planId: z.string().min(1),
    billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
});
export const AddMemberSchema = z.object({
    userId: UuidSchema,
});
export const UpdateRoleSchema = z.object({
    role: OrgRoleSchema,
});
export const CreateInvitationSchema = z.object({
    email: z.string().email(),
    role: OrgRoleSchema.default("member"),
});
export const AcceptInvitationSchema = z.object({
    token: z.string().length(64),
});
export class OrganizationError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode = 400) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = "OrganizationError";
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
//# sourceMappingURL=types.js.map