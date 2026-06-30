/**
 * Organization module types — enterprise-grade schemas, DTOs, and errors.
 *
 * All enums match PostgreSQL enum types exactly.
 * All Zod schemas enforce server-side validation.
 * Cursor-based pagination for scalable list APIs.
 */
import type { FastifyBaseLogger } from "fastify";
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
    member: "member";
    admin: "admin";
    owner: "owner";
    billing: "billing";
    developer: "developer";
    viewer: "viewer";
}>;
export declare const InvitationStatusSchema: z.ZodEnum<{
    expired: "expired";
    revoked: "revoked";
    pending: "pending";
    accepted: "accepted";
    declined: "declined";
}>;
export declare const JoinMethodSchema: z.ZodEnum<{
    scim: "scim";
    invite: "invite";
    admin_add: "admin_add";
    sso_auto_provision: "sso_auto_provision";
}>;
export declare const QuotaRequestStatusSchema: z.ZodEnum<{
    pending: "pending";
    approved: "approved";
    rejected: "rejected";
    cancelled: "cancelled";
}>;
export declare const QuotaTypeSchema: z.ZodEnum<{
    events: "events";
    members: "members";
    api_requests: "api_requests";
    projects: "projects";
    storage: "storage";
    alerts: "alerts";
}>;
export declare const SecurityEventSeveritySchema: z.ZodEnum<{
    low: "low";
    medium: "medium";
    high: "high";
    critical: "critical";
}>;
export type OrgStatus = z.infer<typeof OrgStatusSchema>;
export type MemberStatus = z.infer<typeof MemberStatusSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;
export type JoinMethod = z.infer<typeof JoinMethodSchema>;
export type QuotaRequestStatus = z.infer<typeof QuotaRequestStatusSchema>;
export type QuotaType = z.infer<typeof QuotaTypeSchema>;
export type SecurityEventSeverity = z.infer<typeof SecurityEventSeveritySchema>;
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
export declare const MemberParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    userId: z.ZodString;
}, z.core.$strip>;
export declare const InvitationIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    invitationId: z.ZodString;
}, z.core.$strip>;
export declare const InvitationParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const EnvironmentParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    envId: z.ZodString;
}, z.core.$strip>;
export declare const ApiKeyParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    keyId: z.ZodString;
}, z.core.$strip>;
export declare const SsoProviderParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    ssoId: z.ZodString;
}, z.core.$strip>;
export declare const ScimTokenParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    tokenId: z.ZodString;
}, z.core.$strip>;
export declare const QuotaRequestParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    requestId: z.ZodString;
}, z.core.$strip>;
export declare const SlugParamsSchema: z.ZodObject<{
    slug: z.ZodString;
}, z.core.$strip>;
export declare const GlobalInvitationParamsSchema: z.ZodObject<{
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
export declare const CreateOrganizationSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    industry: z.ZodOptional<z.ZodString>;
    companySize: z.ZodOptional<z.ZodString>;
    country: z.ZodOptional<z.ZodString>;
    timezone: z.ZodDefault<z.ZodString>;
    billingEmail: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const UpdateOrganizationSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    logoUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    websiteUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    industry: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    companySize: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    country: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    timezone: z.ZodOptional<z.ZodString>;
    billingEmail: z.ZodOptional<z.ZodString>;
    supportEmail: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const TransferOwnershipSchema: z.ZodObject<{
    newOwnerUserId: z.ZodString;
}, z.core.$strip>;
export declare const UpdateSettingsSchema: z.ZodObject<{
    enforceSso: z.ZodOptional<z.ZodBoolean>;
    enforceMfa: z.ZodOptional<z.ZodBoolean>;
    sessionTimeoutMinutes: z.ZodOptional<z.ZodNumber>;
    dataRegion: z.ZodOptional<z.ZodEnum<{
        "us-east-1": "us-east-1";
        "eu-west-1": "eu-west-1";
        "ap-south-1": "ap-south-1";
    }>>;
    dataRetentionDays: z.ZodOptional<z.ZodNumber>;
    auditLogRetentionDays: z.ZodOptional<z.ZodNumber>;
    allowPublicProjects: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const UpdateMemberRoleSchema: z.ZodObject<{
    role: z.ZodEnum<{
        security: "security";
        member: "member";
        admin: "admin";
        billing: "billing";
        developer: "developer";
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
        member: "member";
        admin: "admin";
        owner: "owner";
        billing: "billing";
        developer: "developer";
        viewer: "viewer";
    }>>;
}, z.core.$strip>;
export declare const SuspendMemberSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const RemoveMemberSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const CreateInvitationSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        security: "security";
        member: "member";
        admin: "admin";
        billing: "billing";
        developer: "developer";
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
export declare const CreateEnvironmentSchema: z.ZodObject<{
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    isProduction: z.ZodDefault<z.ZodBoolean>;
}, z.core.$strip>;
export declare const UpdateEnvironmentSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    isProduction: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const CreateApiKeySchema: z.ZodObject<{
    name: z.ZodString;
    environmentId: z.ZodOptional<z.ZodString>;
    role: z.ZodDefault<z.ZodEnum<{
        security: "security";
        member: "member";
        admin: "admin";
        billing: "billing";
        developer: "developer";
        viewer: "viewer";
    }>>;
    expiresInDays: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const CreateSsoProviderSchema: z.ZodObject<{
    providerName: z.ZodString;
    providerType: z.ZodEnum<{
        oidc: "oidc";
        saml: "saml";
    }>;
    entityId: z.ZodOptional<z.ZodString>;
    ssoUrl: z.ZodOptional<z.ZodString>;
    x509Certificate: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const UpdateSsoProviderSchema: z.ZodObject<{
    providerName: z.ZodOptional<z.ZodString>;
    entityId: z.ZodOptional<z.ZodString>;
    ssoUrl: z.ZodOptional<z.ZodString>;
    x509Certificate: z.ZodOptional<z.ZodString>;
    domain: z.ZodOptional<z.ZodString>;
    isActive: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const CreateQuotaRequestSchema: z.ZodObject<{
    quotaType: z.ZodString;
    currentLimit: z.ZodNumber;
    requestedLimit: z.ZodNumber;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const ReviewQuotaRequestSchema: z.ZodObject<{
    notes: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
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
export declare const AuditLogQuerySchema: z.ZodObject<{
    cursor: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
    action: z.ZodOptional<z.ZodString>;
    entityType: z.ZodOptional<z.ZodString>;
    actorUserId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
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
export interface CreateAuditLogRecord {
    orgId: string;
    actorUserId: string | null;
    actorEmail?: string;
    actorIp?: string;
    actorUserAgent?: string | null;
    actorSessionId?: string;
    action: string;
    entityType: string;
    entityId?: string;
    entityName?: string;
    requestId?: string;
    correlationId?: string;
    httpMethod?: string;
    endpoint?: string;
    oldValues?: Record<string, unknown> | null;
    newValues?: Record<string, unknown> | null;
    changedFields?: string[];
    status?: "success" | "failure";
    failureReason?: string;
    isSensitive?: boolean;
    metadata?: Record<string, unknown>;
}
export interface OrganizationRow {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    website_url: string | null;
    industry: string | null;
    company_size: string | null;
    country: string | null;
    timezone: string;
    billing_email: string | null;
    support_email: string | null;
    owner_user_id: string;
    created_by: string | null;
    status: OrgStatus;
    deleted_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
export interface OrgSettingsRow {
    org_id: string;
    enforce_sso: boolean;
    enforce_mfa: boolean;
    session_timeout_minutes: number;
    data_region: string;
    data_retention_days: number;
    audit_log_retention_days: number;
    allow_public_projects: boolean;
    created_at: Date;
    updated_at: Date;
}
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
export interface OrgInvitationRow {
    id: string;
    org_id: string;
    invited_by: string;
    invited_by_email: string | null;
    invited_by_name: string | null;
    email: string;
    email_hash?: string;
    role: OrgRole;
    token_hash?: string;
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
export interface OrgEnvironmentRow {
    id: string;
    org_id: string;
    name: string;
    slug: string;
    description: string | null;
    is_production: boolean;
    created_by: string | null;
    created_at: Date;
}
export interface OrgApiKeyRow {
    id: string;
    org_id: string;
    environment_id: string | null;
    name: string;
    key_prefix: string;
    role: OrgRole;
    last_used_at: Date | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    created_by: string | null;
    created_at: Date;
}
export interface OrgSsoProviderRow {
    id: string;
    org_id: string;
    provider_name: string;
    provider_type: string;
    entity_id: string | null;
    sso_url: string | null;
    domain: string | null;
    is_active: boolean;
    created_at: Date;
}
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
export interface AuditLogRow {
    id: string;
    org_id: string;
    actor_user_id: string | null;
    actor_email: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    entity_name: string | null;
    old_values: Record<string, unknown> | null;
    new_values: Record<string, unknown> | null;
    changed_fields: string[] | null;
    status: string;
    is_sensitive: boolean;
    metadata: Record<string, unknown>;
    created_at: Date;
}
export interface QuotaRequestRow {
    id: string;
    org_id: string;
    quota_type: string;
    current_limit: number;
    requested_limit: number;
    reason: string;
    status: QuotaRequestStatus;
    reviewed_by: string | null;
    reviewed_at: Date | null;
    notes: string | null;
    metadata: Record<string, unknown>;
    created_at: Date;
    updated_at: Date;
}
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
export interface OrganizationDto {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    industry: string | null;
    companySize: string | null;
    country: string | null;
    timezone: string;
    billingEmail: string | null;
    supportEmail: string | null;
    ownerUserId: string;
    status: OrgStatus;
    createdAt: Date;
    updatedAt: Date;
}
export interface UserOrganizationDto {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    role: OrgRole;
    status: OrgStatus;
    createdAt: Date;
}
export interface OrgSettingsDto {
    enforceSso: boolean;
    enforceMfa: boolean;
    sessionTimeoutMinutes: number;
    dataRegion: string;
    dataRetentionDays: number;
    auditLogRetentionDays: number;
    allowPublicProjects: boolean;
}
export interface MemberDto {
    id: string;
    userId: string;
    email: string;
    fullName: string;
    role: OrgRole;
    status: MemberStatus;
    joinedAt: Date | null;
    lastActiveAt: Date | null;
    createdAt: Date;
}
export interface InvitationDto {
    id: string;
    email: string;
    role: OrgRole;
    status: InvitationStatus;
    expiresAt: Date;
    invitedAt: Date;
    invitedBy: {
        id: string;
        email: string | null;
        name: string | null;
    };
}
export interface EnvironmentDto {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    isProduction: boolean;
    createdAt: Date;
}
export interface ApiKeyDto {
    id: string;
    name: string;
    keyPrefix: string;
    role: OrgRole;
    environmentId: string | null;
    lastUsedAt: Date | null;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}
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
export interface AuditLogDto {
    id: string;
    actorUserId: string | null;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    entityName: string | null;
    status: string;
    createdAt: Date;
}
export interface QuotaRequestDto {
    id: string;
    quotaType: string;
    currentLimit: number;
    requestedLimit: number;
    reason: string;
    status: QuotaRequestStatus;
    reviewedAt: Date | null;
    notes: string | null;
    createdAt: Date;
}
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
}
export type OrganizationRepository = import("./repository.js").OrganizationRepository;
export declare class OrganizationError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(message: string, code: string, statusCode?: number);
}
export declare class ConflictError extends OrganizationError {
    constructor(message: string);
}
export declare class NotFoundError extends OrganizationError {
    constructor(resource: string);
}
export declare class ForbiddenError extends OrganizationError {
    constructor(message?: string);
}
export declare class ValidationError extends OrganizationError {
    constructor(message: string);
}
export declare class OrgStatusError extends OrganizationError {
    constructor(status: OrgStatus);
}
//# sourceMappingURL=types.d.ts.map