/**
 * Organization module types — enterprise-grade schemas, DTOs, and errors.
 *
 * All enums match PostgreSQL enum types exactly.
 * All Zod schemas enforce server-side validation.
 * Cursor-based pagination for scalable list APIs.
 */
import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import {
  OrgStatusSchema,
  MemberStatusSchema,
  OrgRoleSchema,
  UuidSchema,
  OrgIdParamsSchema,
  IdParamsSchema,
  CursorPaginationSchema,
} from "./shared/types.js";
import type {
  OrgStatus,
  MemberStatus,
  OrgRole,
  CursorPaginationQuery,
  CursorPaginatedResponse,
  RequestMeta,
} from "./shared/types.js";

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
export type JoinMethod = z.infer<typeof JoinMethodSchema>;
export type { QuotaRequestStatus, QuotaType } from "./quotas/quotas.schema.js";
export type SecurityEventSeverity = z.infer<typeof SecurityEventSeveritySchema>;

// (exported via shared/types.js)

// ═══════════════════════════════════════════════════
// COMMON PARAM SCHEMAS
// ═══════════════════════════════════════════════════

// (exported via shared/types.js)


// (exported via shared/types.js)

// ═══════════════════════════════════════════════════
// ORGANIZATION SCHEMAS
// ═══════════════════════════════════════════════════

export {
  SwitchOrganizationSchema,
  SlugParamsSchema,
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
  TransferOwnershipSchema,
  UpdateSettingsSchema
} from "./core/core.schema.js";
export type {
  OrganizationRow,
  OrgSettingsRow,
  OrganizationDto,
  OrgSettingsDto,
  UserOrganizationDto,
  OrganizationProvisioningResult
} from "./core/core.schema.js";

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

export { 
  InvitationStatusSchema,
  InvitationIdParamsSchema,
  InvitationParamsSchema,
  GlobalInvitationParamsSchema,
  CreateInvitationSchema,
  AcceptInvitationSchema,
  InvitationValidateQuerySchema,
  InvitationListQuerySchema
} from "./invitations/invitations.schema.js";
export type { InvitationStatus, OrgInvitationRow } from "./invitations/invitations.schema.js";



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

// (exported via shared/types.js)

// ═══════════════════════════════════════════════════
// AUDIT LOG TYPES — matches enterprise organization_audit_logs schema
// ═══════════════════════════════════════════════════

export type { CreateAuditLogRecord } from "./audit-logs/audit-logs.schema.js";

// ═══════════════════════════════════════════════════
// DB ROW TYPES — snake_case matching database columns
// ═══════════════════════════════════════════════════



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

// ═══════════════════════════════════════════════════
// RESPONSE DTOs — only expose safe, necessary fields
// ═══════════════════════════════════════════════════



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
    p50: { thresholdMs: number; alertEnabled: boolean };
    p75: { thresholdMs: number; alertEnabled: boolean };
    p90: { thresholdMs: number; alertEnabled: boolean };
    p95: { thresholdMs: number; alertEnabled: boolean };
    p99: { thresholdMs: number; alertEnabled: boolean };
  };
  errorRate: { thresholdPercent: number; alertEnabled: boolean };
  apdex: { threshold: number; alertEnabled: boolean };
  evaluationWindowMinutes: number;
  cooldownMinutes: number;
  alertsEnabled: boolean;
  notifyEmails: string[];
  lastAlertedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ═══════════════════════════════════════════════════
// SERVICE DEPENDENCIES
// ═══════════════════════════════════════════════════

export interface OrganizationServiceDependencies {
  repository: OrganizationRepository;
  logger: FastifyBaseLogger;
  emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  scimTokenService: import("../scim/scim-token.service.js").ScimTokenService;
}

// Forward-declare to avoid circular — actual class is in repository.ts
export type OrganizationRepository = import("./repository.js").OrganizationRepository;

// ═══════════════════════════════════════════════════
// ERROR CLASSES
// ═══════════════════════════════════════════════════

export {
  OrganizationError,
  ConflictError,
  NotFoundError,
  ForbiddenError,
  ValidationError,
  OrgStatusError,
} from "./shared/errors.js";
