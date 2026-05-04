import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
export declare const OrgStatusSchema: z.ZodEnum<{
    active: "active";
    suspended: "suspended";
    cancelled: "cancelled";
    trial_expired: "trial_expired";
}>;
export declare const SubscriptionStatusSchema: z.ZodEnum<{
    active: "active";
    trialing: "trialing";
    past_due: "past_due";
    canceled: "canceled";
    unpaid: "unpaid";
    paused: "paused";
}>;
export declare const OrgRoleSchema: z.ZodEnum<{
    admin: "admin";
    member: "member";
}>;
export declare const JoinMethodSchema: z.ZodEnum<{
    invite: "invite";
    sso_auto_provision: "sso_auto_provision";
    admin_add: "admin_add";
    self_created: "self_created";
}>;
export declare const AuditActionSchema: z.ZodEnum<{
    "user.created": "user.created";
    "user.updated": "user.updated";
    "user.deleted": "user.deleted";
    "user.login": "user.login";
    "user.password_changed": "user.password_changed";
    "user.mfa_disabled": "user.mfa_disabled";
    "user.logout": "user.logout";
    "user.mfa_enabled": "user.mfa_enabled";
    "org.created": "org.created";
    "org.updated": "org.updated";
    "org.deleted": "org.deleted";
    "org.member_invited": "org.member_invited";
    "org.member_joined": "org.member_joined";
    "org.member_removed": "org.member_removed";
    "org.role_changed": "org.role_changed";
    "project.created": "project.created";
    "project.updated": "project.updated";
    "project.deleted": "project.deleted";
    "project.api_key_created": "project.api_key_created";
    "project.api_key_revoked": "project.api_key_revoked";
    "alert_rule.created": "alert_rule.created";
    "alert_rule.updated": "alert_rule.updated";
    "alert_rule.deleted": "alert_rule.deleted";
    "alert_rule.triggered": "alert_rule.triggered";
    "billing.subscription_created": "billing.subscription_created";
    "billing.subscription_cancelled": "billing.subscription_cancelled";
    "billing.payment_succeeded": "billing.payment_succeeded";
    "billing.payment_failed": "billing.payment_failed";
    "security.suspicious_login_blocked": "security.suspicious_login_blocked";
    "security.mfa_challenge_failed": "security.mfa_challenge_failed";
    "security.token_revoked": "security.token_revoked";
    "security.session_terminated": "security.session_terminated";
    "data.export_requested": "data.export_requested";
    "data.deletion_requested": "data.deletion_requested";
    "data.deletion_completed": "data.deletion_completed";
    "admin.impersonation_started": "admin.impersonation_started";
    "admin.impersonation_ended": "admin.impersonation_ended";
    "admin.force_password_reset": "admin.force_password_reset";
}>;
export declare const AuditResourceTypeSchema: z.ZodEnum<{
    user: "user";
    invoice: "invoice";
    organization: "organization";
    project: "project";
    api_key: "api_key";
    alert_rule: "alert_rule";
    subscription: "subscription";
    session: "session";
    audit_log: "audit_log";
}>;
export type OrgStatus = z.infer<typeof OrgStatusSchema>;
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type JoinMethod = z.infer<typeof JoinMethodSchema>;
export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditResourceType = z.infer<typeof AuditResourceTypeSchema>;
export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked";
export declare const UuidSchema: z.ZodString;
export declare const BillingAddressSchema: z.ZodObject<{
    street: z.ZodString;
    city: z.ZodString;
    state: z.ZodOptional<z.ZodString>;
    zip: z.ZodString;
    country: z.ZodString;
    vatId: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const IdParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const MemberParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    userId: z.ZodString;
}, z.core.$strip>;
export declare const InvitationParamsSchema: z.ZodObject<{
    id: z.ZodString;
}, z.core.$strip>;
export declare const SlugParamsSchema: z.ZodObject<{
    slug: z.ZodString;
}, z.core.$strip>;
export declare const PaginationQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const AuditQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export declare const InvitationListQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    status: z.ZodOptional<z.ZodEnum<{
        revoked: "revoked";
        pending: "pending";
        accepted: "accepted";
        declined: "declined";
    }>>;
}, z.core.$strip>;
export declare const InvitationValidateQuerySchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export declare const CreateOrganizationSchema: z.ZodObject<{
    name: z.ZodString;
}, z.core.$strip>;
export declare const UpdateOrganizationSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    websiteUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    billingEmail: z.ZodOptional<z.ZodString>;
    billingName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    billingAddress: z.ZodOptional<z.ZodNullable<z.ZodObject<{
        street: z.ZodString;
        city: z.ZodString;
        state: z.ZodOptional<z.ZodString>;
        zip: z.ZodString;
        country: z.ZodString;
        vatId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>>;
    dataRegion: z.ZodOptional<z.ZodEnum<{
        "us-east-1": "us-east-1";
        "eu-west-1": "eu-west-1";
        "ap-south-1": "ap-south-1";
    }>>;
    enforceSso: z.ZodOptional<z.ZodBoolean>;
    enforceMfa: z.ZodOptional<z.ZodBoolean>;
    allowedEmailDomains: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    sessionTimeoutMinutes: z.ZodOptional<z.ZodNumber>;
    dataRetentionDays: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const UpdateBillingSchema: z.ZodObject<{
    billingEmail: z.ZodString;
    billingName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    billingAddress: z.ZodObject<{
        street: z.ZodString;
        city: z.ZodString;
        state: z.ZodOptional<z.ZodString>;
        zip: z.ZodString;
        country: z.ZodString;
        vatId: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
}, z.core.$strip>;
export declare const UpdateSecuritySchema: z.ZodObject<{
    enforceSso: z.ZodBoolean;
    enforceMfa: z.ZodBoolean;
    allowedEmailDomains: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    ipAllowlist: z.ZodOptional<z.ZodNullable<z.ZodArray<z.ZodString>>>;
    sessionTimeoutMinutes: z.ZodDefault<z.ZodNumber>;
}, z.core.$strip>;
export declare const UpgradePlanSchema: z.ZodObject<{
    planId: z.ZodString;
    billingCycle: z.ZodDefault<z.ZodEnum<{
        monthly: "monthly";
        annual: "annual";
    }>>;
}, z.core.$strip>;
export declare const AddMemberSchema: z.ZodObject<{
    userId: z.ZodString;
}, z.core.$strip>;
export declare const UpdateRoleSchema: z.ZodObject<{
    role: z.ZodEnum<{
        admin: "admin";
        member: "member";
    }>;
}, z.core.$strip>;
export declare const CreateInvitationSchema: z.ZodObject<{
    email: z.ZodString;
    role: z.ZodDefault<z.ZodEnum<{
        admin: "admin";
        member: "member";
    }>>;
}, z.core.$strip>;
export declare const AcceptInvitationSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema>;
export type UpdateBillingInput = z.infer<typeof UpdateBillingSchema>;
export type UpdateSecurityInput = z.infer<typeof UpdateSecuritySchema>;
export type UpgradePlanInput = z.infer<typeof UpgradePlanSchema>;
export type AddMemberInput = z.infer<typeof AddMemberSchema>;
export type UpdateRoleInput = z.infer<typeof UpdateRoleSchema>;
export type CreateInvitationInput = z.infer<typeof CreateInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof AcceptInvitationSchema>;
export type BillingAddress = z.infer<typeof BillingAddressSchema>;
export interface PaginationQuery {
    limit: number;
    offset: number;
}
export interface PaginatedResponse<T> {
    data: T[];
    pagination: {
        total: number;
        limit: number;
        offset: number;
    };
}
export interface OrganizationRow {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    ownerUserId: string;
    status: OrgStatus;
    billingStatus: SubscriptionStatus | null;
    billingEmail: string;
    billingName: string | null;
    billingAddress: BillingAddress | null;
    planId: string | null;
    planStartedAt: Date | null;
    planExpiresAt: Date | null;
    trialEndsAt: Date | null;
    gracePeriodEndsAt: Date | null;
    enforceSso: boolean;
    enforceMfa: boolean;
    allowedEmailDomains: string[] | null;
    ipAllowlist: string[] | null;
    sessionTimeoutMinutes: number;
    dataRegion: string;
    dataRetentionDays: number;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}
export interface UserOrganizationRow {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    role: OrgRole;
    createdAt: Date;
}
export interface OrganizationMemberRow {
    id: string;
    orgId: string;
    userId: string;
    email: string;
    fullName: string;
    role: OrgRole;
    isActive: boolean;
    createdAt: Date;
    lastActiveAt: Date | null;
}
export interface OrganizationInvitationRow {
    id: string;
    orgId: string;
    invitedBy: string;
    invitedByEmail: string | null;
    invitedByName: string | null;
    email: string;
    emailHash?: string;
    role: OrgRole;
    tokenHash?: string;
    expiresAt: Date;
    acceptedAt: Date | null;
    acceptedBy: string | null;
    declinedAt: Date | null;
    revokedAt: Date | null;
    revokedBy: string | null;
    resentCount: number;
    lastResentAt: Date | null;
    createdAt: Date;
}
export interface AuditLogRow {
    id: string;
    orgId: string | null;
    userId: string | null;
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId: string | null;
    metadata: Record<string, unknown> | null;
    ipAddress: string;
    userAgent: string | null;
    createdAt: Date;
}
export interface OrganizationResponseDto {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    websiteUrl: string | null;
    ownerUserId: string;
    status: OrgStatus;
    createdAt: Date;
    updatedAt: Date;
}
export interface UserOrganizationResponseDto {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    role: OrgRole;
    createdAt: Date;
}
export interface BillingResponseDto {
    billingEmail: string;
    billingName: string | null;
    billingAddress: BillingAddress | null;
    planId: string | null;
    billingStatus: SubscriptionStatus | null;
    planStartedAt: Date | null;
    planExpiresAt: Date | null;
}
export interface PlanResponseDto {
    planId: string | null;
    billingStatus: SubscriptionStatus | null;
    trialEndsAt: Date | null;
    planExpiresAt: Date | null;
}
export interface SecuritySettingsResponseDto {
    enforceSso: boolean;
    enforceMfa: boolean;
    allowedEmailDomains: string[] | null;
    ipAllowlist: string[] | null;
    sessionTimeoutMinutes: number;
}
export interface MemberResponseDto {
    id: string;
    userId: string;
    email: string;
    name: string;
    role: OrgRole;
    isActive: boolean;
    createdAt: Date;
    lastActiveAt: Date | null;
}
export interface InvitationResponseDto {
    id: string;
    email: string;
    role: OrgRole;
    status: InvitationStatus;
    invitedAt: Date;
    expiresAt: Date;
    invitedBy: {
        id: string;
        email: string | null;
        name: string | null;
    };
}
export interface AuditLogResponseDto {
    id: string;
    userId: string | null;
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
}
export interface CreateOrganizationRecord {
    name: string;
    ownerUserId: string;
}
export interface UpdateOrganizationRecord {
    name?: string | undefined;
    description?: string | null | undefined;
    websiteUrl?: string | null | undefined;
    logoUrl?: string | null | undefined;
    ownerUserId?: string | undefined;
    status?: OrgStatus | undefined;
    billingStatus?: SubscriptionStatus | undefined;
    billingEmail?: string | undefined;
    billingName?: string | null | undefined;
    billingAddress?: BillingAddress | null | undefined;
    planId?: string | undefined;
    planStartedAt?: Date | undefined;
    planExpiresAt?: Date | null | undefined;
    trialEndsAt?: Date | null | undefined;
    gracePeriodEndsAt?: Date | null | undefined;
    enforceSso?: boolean | undefined;
    enforceMfa?: boolean | undefined;
    allowedEmailDomains?: string[] | null | undefined;
    ipAllowlist?: string[] | null | undefined;
    sessionTimeoutMinutes?: number | undefined;
    dataRegion?: string | undefined;
    dataRetentionDays?: number | undefined;
    deletedAt?: Date | null | undefined;
}
export interface AddMemberRecord {
    orgId: string;
    userId: string;
    isActive: boolean;
    invitedBy: string | null;
    invitedAt: Date | null;
    joinedMethod: JoinMethod;
    lastActiveAt: Date | null;
}
export interface CreateInvitationRecord {
    orgId: string;
    invitedBy: string;
    email: string;
    role: OrgRole;
    tokenHash: string;
    expiresAt: Date;
}
export interface CreateAuditLogRecord {
    orgId: string;
    userId: string | null;
    action: AuditAction;
    resourceType: AuditResourceType;
    resourceId: string | null;
    metadata: Record<string, unknown> | null;
    ipAddress: string;
    userAgent: string | null;
}
export interface IOrganizationRepository {
    create(org: CreateOrganizationRecord): Promise<OrganizationRow>;
    findById(id: string, includeDeleted?: boolean): Promise<OrganizationRow | null>;
    findBySlug(slug: string): Promise<OrganizationRow | null>;
    findByUserId(userId: string, pagination: PaginationQuery): Promise<PaginatedResponse<UserOrganizationRow>>;
    update(id: string, data: UpdateOrganizationRecord): Promise<OrganizationRow>;
    softDelete(id: string, deletedBy: string): Promise<void>;
    restore(id: string): Promise<void>;
    addMember(member: AddMemberRecord): Promise<OrganizationMemberRow>;
    removeMember(orgId: string, userId: string, deactivatedBy: string, reason?: string): Promise<void>;
    findMember(orgId: string, userId: string): Promise<OrganizationMemberRow | null>;
    findMembersByOrgId(orgId: string, pagination: PaginationQuery): Promise<PaginatedResponse<OrganizationMemberRow>>;
    updateMemberRole(orgId: string, userId: string): Promise<void>;
    transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void>;
    createInvitation(invitation: CreateInvitationRecord): Promise<OrganizationInvitationRow>;
    findInvitationById(id: string, includeSecrets?: boolean): Promise<OrganizationInvitationRow | null>;
    findInvitationByTokenHash(tokenHash: string): Promise<OrganizationInvitationRow | null>;
    findInvitationsByOrgId(orgId: string, pagination: PaginationQuery, status?: InvitationStatus): Promise<PaginatedResponse<OrganizationInvitationRow>>;
    acceptInvitation(tokenHash: string, acceptedBy: string): Promise<void>;
    declineInvitation(id: string): Promise<void>;
    revokeInvitation(id: string, revokedBy: string): Promise<void>;
    incrementResentCount(id: string): Promise<void>;
    createAuditLog(entry: CreateAuditLogRecord): Promise<void>;
    findAuditLogs(orgId: string, pagination: PaginationQuery): Promise<PaginatedResponse<AuditLogRow>>;
}
export interface OrganizationServiceDependencies {
    repository: IOrganizationRepository;
    logger: FastifyBaseLogger;
    emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}
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
//# sourceMappingURL=types.d.ts.map