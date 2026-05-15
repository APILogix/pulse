/**
 * Organization module types — enterprise-grade schemas, DTOs, and errors.
 *
 * All enums match PostgreSQL enum types exactly.
 * All Zod schemas enforce server-side validation.
 * Cursor-based pagination for scalable list APIs.
 */
import type { FastifyBaseLogger } from "fastify";
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

export type OrgStatus = z.infer<typeof OrgStatusSchema>;
export type MemberStatus = z.infer<typeof MemberStatusSchema>;
export type OrgRole = z.infer<typeof OrgRoleSchema>;
export type InvitationStatus = z.infer<typeof InvitationStatusSchema>;
export type JoinMethod = z.infer<typeof JoinMethodSchema>;
export type QuotaRequestStatus = z.infer<typeof QuotaRequestStatusSchema>;
export type QuotaType = z.infer<typeof QuotaTypeSchema>;
export type SecurityEventSeverity = z.infer<typeof SecurityEventSeveritySchema>;

// ═══════════════════════════════════════════════════
// ROLE HIERARCHY — owner > admin > developer > security = billing > member > viewer
// ═══════════════════════════════════════════════════

export const ROLE_HIERARCHY: Record<OrgRole, number> = {
  owner: 100,
  admin: 80,
  developer: 60,
  security: 50,
  billing: 50,
  member: 40,
  viewer: 20,
};

/** Check if a user role meets or exceeds the required role level. */
export function hasMinRole(userRole: OrgRole, requiredRole: OrgRole): boolean {
  return (ROLE_HIERARCHY[userRole] ?? 0) >= (ROLE_HIERARCHY[requiredRole] ?? 0);
}

/** Check if an actor can manage (modify role of) a target user. */
export function canManageRole(actorRole: OrgRole, targetRole: OrgRole): boolean {
  return (ROLE_HIERARCHY[actorRole] ?? 0) > (ROLE_HIERARCHY[targetRole] ?? 0);
}

// ═══════════════════════════════════════════════════
// ORG STATUS GATES — prevent mutations on inactive orgs
// ═══════════════════════════════════════════════════

const MUTABLE_STATUSES: Set<OrgStatus> = new Set(["active", "trialing"]);
const READABLE_STATUSES: Set<OrgStatus> = new Set([
  "active",
  "trialing",
  "suspended",
  "locked",
  "archived",
  "delinquent",
]);

export function isMutableOrg(status: OrgStatus): boolean {
  return MUTABLE_STATUSES.has(status);
}

export function isReadableOrg(status: OrgStatus): boolean {
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

export type CursorPaginationQuery = z.infer<typeof CursorPaginationSchema>;

export interface CursorPaginatedResponse<T> {
  data: T[];
  meta: {
    hasMore: boolean;
    nextCursor: string | null;
    limit: number;
  };
}

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
// REQUEST METADATA — extracted from every authenticated request
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
// AUDIT LOG TYPES — matches enterprise audit_logs schema
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
// DB ROW TYPES — snake_case matching database columns
// ═══════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════
// RESPONSE DTOs — only expose safe, necessary fields
// ═══════════════════════════════════════════════════

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
  invitedBy: { id: string; email: string | null; name: string | null };
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

// ═══════════════════════════════════════════════════
// SERVICE DEPENDENCIES
// ═══════════════════════════════════════════════════

export interface OrganizationServiceDependencies {
  repository: OrganizationRepository;
  logger: FastifyBaseLogger;
  emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

// Forward-declare to avoid circular — actual class is in repository.ts
export type OrganizationRepository = import("./repository.js").OrganizationRepository;

// ═══════════════════════════════════════════════════
// ERROR CLASSES
// ═══════════════════════════════════════════════════

export class OrganizationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.name = "OrganizationError";
    this.statusCode = statusCode;
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

export class OrgStatusError extends OrganizationError {
  constructor(status: OrgStatus) {
    super(
      `Organization is ${status}. This action is not permitted.`,
      "ORG_STATUS_INVALID",
      403,
    );
  }
}
