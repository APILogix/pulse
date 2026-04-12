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
export const OrgRoleSchema = z.enum(["owner", "admin", "member", "viewer", "billing"]);
export const JoinMethodSchema = z.enum(["invite", "sso_auto_provision", "admin_add"]);

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
export const MemberParamsSchema = z.object({ orgId: UuidSchema, userId: UuidSchema });
export const InvitationParamsSchema = z.object({ id: UuidSchema });
export const SlugParamsSchema = z.object({ slug: z.string().min(1).max(255) });

export const AuditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const InvitationListQuerySchema = z.object({
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
  ipAllowlist: z.array(z.string().regex(ipv4Regex, "Invalid IPv4 or CIDR")).nullable().optional(),
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
  ipAllowlist: z.array(z.string().regex(ipv4Regex, "Invalid IPv4 or CIDR")).nullable().optional(),
  sessionTimeoutMinutes: z.number().int().min(5).max(1440).default(480),
});

export const UpgradePlanSchema = z.object({
  planId: z.string().min(1),
  billingCycle: z.enum(["monthly", "annual"]).default("monthly"),
});

export const AddMemberSchema = z.object({
  userId: UuidSchema,
  role: OrgRoleSchema.default("member"),
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

export interface Organization {
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
  planId: string;
  planStartedAt: Date;
  planExpiresAt: Date | null;
  trialStartedAt: Date | null;
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
  deletedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationMember {
  id: string;
  orgId: string;
  userId: string;
  role: OrgRole;
  permissions: Record<string, boolean>;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedBy: string | null;
  deactivationReason: string | null;
  invitedBy: string | null;
  invitedAt: Date | null;
  joinedAt: Date;
  joinedMethod: JoinMethod;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrganizationInvitation {
  id: string;
  orgId: string;
  invitedBy: string;
  email: string;
  emailHash: string;
  role: OrgRole;
  tokenHash: string;
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

export interface AuditLog {
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

export interface CreateOrganizationRecord {
  name: string;
  ownerUserId: string;
}

export interface UpdateOrganizationRecord {
  name?: string;
  description?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  ownerUserId?: string;
  status?: OrgStatus;
  billingStatus?: SubscriptionStatus;
  billingEmail?: string;
  billingName?: string | null;
  billingAddress?: BillingAddress | null;
  planId?: string;
  planStartedAt?: Date;
  planExpiresAt?: Date | null;
  trialStartedAt?: Date | null;
  trialEndsAt?: Date | null;
  gracePeriodEndsAt?: Date | null;
  enforceSso?: boolean;
  enforceMfa?: boolean;
  allowedEmailDomains?: string[] | null;
  ipAllowlist?: string[] | null;
  sessionTimeoutMinutes?: number;
  dataRegion?: string;
  dataRetentionDays?: number;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}

export interface AddMemberRecord {
  orgId: string;
  userId: string;
  role: OrgRole;
  permissions: Record<string, boolean>;
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

export interface IOrganizationRepository {
  create(org: CreateOrganizationRecord): Promise<Organization>;
  findById(id: string, includeDeleted?: boolean): Promise<Organization | null>;
  findBySlug(slug: string): Promise<Organization | null>;
  findByUserId(userId: string): Promise<Array<{ id: string; name: string; logoUrl: string | null }>>;
  update(id: string, data: UpdateOrganizationRecord): Promise<Organization>;
  softDelete(id: string, deletedBy: string): Promise<void>;
  restore(id: string): Promise<void>;

  addMember(member: AddMemberRecord): Promise<OrganizationMember>;
  removeMember(orgId: string, userId: string, deactivatedBy: string, reason?: string): Promise<void>;
  findMember(orgId: string, userId: string): Promise<OrganizationMember | null>;
  findMembersByOrgId(orgId: string): Promise<OrganizationMember[]>;
  updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void>;
  transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void>;
  countActiveOwners(orgId: string): Promise<number>;

  createInvitation(invitation: CreateInvitationRecord): Promise<OrganizationInvitation>;
  findInvitationById(id: string): Promise<OrganizationInvitation | null>;
  findInvitationByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null>;
  findInvitationsByOrgId(
    orgId: string,
    status?: "pending" | "accepted" | "declined" | "revoked",
  ): Promise<OrganizationInvitation[]>;
  acceptInvitation(tokenHash: string, acceptedBy: string): Promise<void>;
  declineInvitation(tokenHash: string): Promise<void>;
  revokeInvitation(id: string, revokedBy: string): Promise<void>;
  incrementResentCount(id: string): Promise<void>;

  createAuditLog(entry: Omit<AuditLog, "id" | "createdAt">): Promise<void>;
  findAuditLogs(orgId: string, limit?: number, offset?: number): Promise<AuditLog[]>;
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
