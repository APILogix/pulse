import type { FastifyBaseLogger } from "fastify";
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

export type OrgStatus = z.infer<typeof OrgStatusSchema>;
export type SubscriptionStatus = z.infer<typeof SubscriptionStatusSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type JoinMethod = z.infer<typeof JoinMethodSchema>;
export type AuditAction = z.infer<typeof AuditActionSchema>;
export type AuditResourceType = z.infer<typeof AuditResourceTypeSchema>;
export type InvitationStatus = "pending" | "accepted" | "declined" | "revoked";

export const UuidSchema = z.string().uuid();

export const BillingAddressSchema = z.object({
  street: z.string().max(255),
  city: z.string().max(100),
  state: z.string().max(100).optional(),
  zip: z.string().max(20),
  country: z.string().length(2),
  vatId: z.string().max(100).optional(),
});

const ipv4Regex =
  /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}(\/([0-9]|[12][0-9]|3[0-2]))?$/;

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
  findByUserId(
    userId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<UserOrganizationRow>>;
  update(id: string, data: UpdateOrganizationRecord): Promise<OrganizationRow>;
  softDelete(id: string, deletedBy: string): Promise<void>;
  restore(id: string): Promise<void>;

  addMember(member: AddMemberRecord): Promise<OrganizationMemberRow>;
  removeMember(
    orgId: string,
    userId: string,
    deactivatedBy: string,
    reason?: string,
  ): Promise<void>;
  findMember(
    orgId: string,
    userId: string,
  ): Promise<OrganizationMemberRow | null>;
  findMembersByOrgId(
    orgId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<OrganizationMemberRow>>;
  updateMemberRole(orgId: string, userId: string): Promise<void>;
  transferOwnership(
    orgId: string,
    fromUserId: string,
    toUserId: string,
  ): Promise<void>;

  createInvitation(
    invitation: CreateInvitationRecord,
  ): Promise<OrganizationInvitationRow>;
  findInvitationById(
    id: string,
    includeSecrets?: boolean,
  ): Promise<OrganizationInvitationRow | null>;
  findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<OrganizationInvitationRow | null>;
  findInvitationsByOrgId(
    orgId: string,
    pagination: PaginationQuery,
    status?: InvitationStatus,
  ): Promise<PaginatedResponse<OrganizationInvitationRow>>;
  acceptInvitation(tokenHash: string, acceptedBy: string): Promise<void>;
  declineInvitation(id: string): Promise<void>;
  revokeInvitation(id: string, revokedBy: string): Promise<void>;
  incrementResentCount(id: string): Promise<void>;

  createAuditLog(entry: CreateAuditLogRecord): Promise<void>;
  findAuditLogs(
    orgId: string,
    pagination: PaginationQuery,
  ): Promise<PaginatedResponse<AuditLogRow>>;
}

export interface OrganizationServiceDependencies {
  repository: IOrganizationRepository;
  logger: FastifyBaseLogger;
  emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export class OrganizationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
    this.name = "OrganizationError";
  }
}

export class ConflictError extends OrganizationError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

export class NotFoundError extends OrganizationError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404);
  }
}

export class ForbiddenError extends OrganizationError {
  constructor(message = "Access denied") {
    super(message, "FORBIDDEN", 403);
  }
}

export class ValidationError extends OrganizationError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 422);
  }
}
