/**
 * Organization module types — enterprise-grade schemas, DTOs, and errors.
 *
 * All enums match PostgreSQL enum types exactly.
 * All Zod schemas enforce server-side validation.
 * Cursor-based pagination for scalable list APIs.
 */
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type { OrgStatus, OrgRole } from "./shared/types.js";
export * from "./shared/types.js";
export declare const JoinMethodSchema: z.ZodEnum<{
    scim: "scim";
    invite: "invite";
    admin_add: "admin_add";
    sso_auto_provision: "sso_auto_provision";
}>;
export { QuotaRequestStatusSchema, QuotaTypeSchema } from "./quotas/quotas.schema.js";
export declare const SecurityEventSeveritySchema: z.ZodEnum<{
    low: "low";
    medium: "medium";
    high: "high";
    critical: "critical";
}>;
export type JoinMethod = z.infer<typeof JoinMethodSchema>;
export type { QuotaRequestStatus, QuotaType } from "./quotas/quotas.schema.js";
export type SecurityEventSeverity = z.infer<typeof SecurityEventSeveritySchema>;
export { SwitchOrganizationSchema, SlugParamsSchema, CreateOrganizationSchema, UpdateOrganizationSchema, TransferOwnershipSchema, UpdateSettingsSchema } from "./core/core.schema.js";
export type { OrganizationRow, OrgSettingsRow, OrganizationDto, OrgSettingsDto, UserOrganizationDto, OrganizationProvisioningResult } from "./core/core.schema.js";
export { MemberParamsSchema } from "./members/members.schema.js";
export declare const SsoProviderParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    ssoId: z.ZodString;
}, z.core.$strip>;
export declare const ScimTokenParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    tokenId: z.ZodString;
}, z.core.$strip>;
export declare const ScimTokenIpSchema: z.ZodString;
export declare const QuotaRequestParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    requestId: z.ZodString;
}, z.core.$strip>;
export { UpdateMemberRoleSchema, MembersListQuerySchema, SuspendMemberSchema, RemoveMemberSchema } from "./members/members.schema.js";
export { InvitationStatusSchema, InvitationIdParamsSchema, InvitationParamsSchema, GlobalInvitationParamsSchema, CreateInvitationSchema, AcceptInvitationSchema, InvitationValidateQuerySchema, InvitationListQuerySchema } from "./invitations/invitations.schema.js";
export type { InvitationStatus, OrgInvitationRow } from "./invitations/invitations.schema.js";
export { CreateSsoProviderSchema, UpdateSsoProviderSchema } from "./sso/sso.schema.js";
export declare const ScimScopeSchema: z.ZodEnum<{
    "users:read": "users:read";
    "users:write": "users:write";
    "users:delete": "users:delete";
    "groups:read": "groups:read";
    "groups:write": "groups:write";
    "groups:delete": "groups:delete";
    bulk: "bulk";
}>;
export declare const CreateScimTokenSchema: z.ZodObject<{
    scopes: z.ZodDefault<z.ZodArray<z.ZodEnum<{
        "users:read": "users:read";
        "users:write": "users:write";
        "users:delete": "users:delete";
        "groups:read": "groups:read";
        "groups:write": "groups:write";
        "groups:delete": "groups:delete";
        bulk: "bulk";
    }>>>;
    allowedIps: z.ZodOptional<z.ZodArray<z.ZodString>>;
    expiresInDays: z.ZodOptional<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export { CreateQuotaRequestSchema, ReviewQuotaRequestSchema } from "./quotas/quotas.schema.js";
/** Query for resolving which scope to read/write (org-wide vs project). */
export declare const AlertThresholdQuerySchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const UpsertAlertThresholdSchema: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    p50ThresholdMs: z.ZodOptional<z.ZodNumber>;
    p75ThresholdMs: z.ZodOptional<z.ZodNumber>;
    p90ThresholdMs: z.ZodOptional<z.ZodNumber>;
    p95ThresholdMs: z.ZodOptional<z.ZodNumber>;
    p99ThresholdMs: z.ZodOptional<z.ZodNumber>;
    p50AlertEnabled: z.ZodOptional<z.ZodBoolean>;
    p75AlertEnabled: z.ZodOptional<z.ZodBoolean>;
    p90AlertEnabled: z.ZodOptional<z.ZodBoolean>;
    p95AlertEnabled: z.ZodOptional<z.ZodBoolean>;
    p99AlertEnabled: z.ZodOptional<z.ZodBoolean>;
    errorRateThresholdPercent: z.ZodOptional<z.ZodNumber>;
    errorRateAlertEnabled: z.ZodOptional<z.ZodBoolean>;
    apdexThreshold: z.ZodOptional<z.ZodNumber>;
    apdexAlertEnabled: z.ZodOptional<z.ZodBoolean>;
    evaluationWindowMinutes: z.ZodOptional<z.ZodNumber>;
    cooldownMinutes: z.ZodOptional<z.ZodNumber>;
    alertsEnabled: z.ZodOptional<z.ZodBoolean>;
    notifyEmails: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export { AuditLogQuerySchema } from "./audit-logs/audit-logs.schema.js";
export declare const SecurityEventsQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    severity: z.ZodOptional<z.ZodEnum<{
        low: "low";
        medium: "medium";
        high: "high";
        critical: "critical";
    }>>;
    eventType: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type { CreateAuditLogRecord } from "./audit-logs/audit-logs.schema.js";
export type { OrgMemberRow } from "./members/members.schema.js";
export type { OrgSsoProviderRow } from "./sso/sso.schema.js";
export interface OrgScimTokenRow {
    id: string;
    org_id: string;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    created_by: string | null;
    created_at: Date;
}
export interface SecurityEventRow {
    id: string;
    org_id: string;
    user_id: string | null;
    event_type: string;
    severity: string;
    ip_address: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
}
export type { AuditLogRow } from "./audit-logs/audit-logs.schema.js";
export type { QuotaRequestRow } from "./quotas/quotas.schema.js";
/** Row type for listing user's organizations with their role */
export interface UserOrgRow {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    status: OrgStatus;
    role: OrgRole;
    created_at: Date;
}
export interface AlertThresholdRow {
    id: string;
    org_id: string;
    project_id: string | null;
    p50_threshold_ms: number;
    p75_threshold_ms: number;
    p90_threshold_ms: number;
    p95_threshold_ms: number;
    p99_threshold_ms: number;
    p50_alert_enabled: boolean;
    p75_alert_enabled: boolean;
    p90_alert_enabled: boolean;
    p95_alert_enabled: boolean;
    p99_alert_enabled: boolean;
    error_rate_threshold_percent: string | number;
    error_rate_alert_enabled: boolean;
    apdex_threshold: string | number;
    apdex_alert_enabled: boolean;
    evaluation_window_minutes: number;
    cooldown_minutes: number;
    alerts_enabled: boolean;
    notify_emails: string[];
    last_alerted_at: Date | null;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
}
export type { MemberDto } from "./members/members.service.js";
export type { InvitationDto } from "./invitations/invitations.service.js";
export interface SsoProviderDto {
    id: string;
    providerName: string;
    providerType: string;
    entityId: string | null;
    ssoUrl: string | null;
    domain: string | null;
    isActive: boolean;
    createdAt: Date;
}
export interface ScimTokenDto {
    id: string;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
    scopes: string[];
    allowedIps: string[];
}
export interface SecurityEventDto {
    id: string;
    userId: string | null;
    eventType: string;
    severity: string;
    ipAddress: string | null;
    metadata: Record<string, unknown>;
    createdAt: Date;
}
export type { AuditLogDto } from "./audit-logs/audit-logs.service.js";
export type { QuotaRequestDto } from "./quotas/quotas.service.js";
export interface AlertThresholdDto {
    id: string;
    orgId: string;
    projectId: string | null;
    latency: {
        p50: {
            thresholdMs: number;
            alertEnabled: boolean;
        };
        p75: {
            thresholdMs: number;
            alertEnabled: boolean;
        };
        p90: {
            thresholdMs: number;
            alertEnabled: boolean;
        };
        p95: {
            thresholdMs: number;
            alertEnabled: boolean;
        };
        p99: {
            thresholdMs: number;
            alertEnabled: boolean;
        };
    };
    errorRate: {
        thresholdPercent: number;
        alertEnabled: boolean;
    };
    apdex: {
        threshold: number;
        alertEnabled: boolean;
    };
    evaluationWindowMinutes: number;
    cooldownMinutes: number;
    alertsEnabled: boolean;
    notifyEmails: string[];
    lastAlertedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface OrganizationServiceDependencies {
    repository: OrganizationRepository;
    logger: FastifyBaseLogger;
    emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
    scimTokenService: import("../scim/scim-token.service.js").ScimTokenService;
}
export type OrganizationRepository = import("./repository.js").OrganizationRepository;
export { OrganizationError, ConflictError, NotFoundError, ForbiddenError, ValidationError, OrgStatusError, } from "./shared/errors.js";
//# sourceMappingURL=types.d.ts.map