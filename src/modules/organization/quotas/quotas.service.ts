import { ForbiddenError } from "../shared/errors.js";
import { entitlementsService, type EntitlementsService } from "../../billing/entitlements/service.js";
import { quotaGuard, type QuotaGuard } from "../../billing/entitlements/quota-guard.js";
import type { QuotasRepository } from "./quotas.repository.js";
import type { RequestMeta, OrgMemberRow, OrgRole, OrganizationRow, CursorPaginationQuery } from "../types.js";
import type { QuotaRequestStatus, BillingEntitlementsRow, OrganizationUsageCounts } from "./quotas.schema.js";
import type { CreateAuditLogRecord } from "../audit-logs/audit-logs.schema.js";

const BILLING_MUTABLE_STATUSES = new Set(["active", "trialing", "past_due"]);

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

export interface QuotasServiceDependencies {
  repository: QuotasRepository;
  requireMutableOrg: (orgId: string) => Promise<OrganizationRow>;
  requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
  audit: (meta: RequestMeta, data: Omit<CreateAuditLogRecord, "orgId" | "actorUserId" | "actorEmail" | "actorIp" | "actorUserAgent" | "actorSessionId" | "requestId" | "httpMethod" | "endpoint"> & { orgId: string }) => Promise<void>;
  entitlements?: EntitlementsService;
  guard?: QuotaGuard;
}

export class QuotasService {
  private readonly entitlements: EntitlementsService;
  private readonly guard: QuotaGuard;

  constructor(private readonly deps: QuotasServiceDependencies) {
    this.entitlements = deps.entitlements ?? entitlementsService;
    this.guard = deps.guard ?? quotaGuard;
  }

  limitFrom(entitlements: BillingEntitlementsRow, keys: string[], fallback = Number.POSITIVE_INFINITY): number {
    const config = entitlements.feature_config ?? {};
    for (const key of keys) {
      const raw = config[key];
      if (typeof raw === "number") return raw;
      if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw))) return Number(raw);
    }
    return fallback;
  }

  featureAllowed(entitlements: BillingEntitlementsRow, keys: string[], fallback = true): boolean {
    const config = entitlements.feature_config ?? {};
    for (const key of keys) {
      const raw = config[key];
      if (typeof raw === "boolean") return raw;
      if (typeof raw === "string") return raw.toLowerCase() === "true";
    }
    return fallback;
  }

  assertWithinLimit(name: string, used: number, limit: number): void {
    if (limit === -1) {
      // Explicit unlimited
      return;
    }
    if (limit >= 0 && Number.isFinite(limit) && used >= limit) {
      throw new ForbiddenError(`${name} limit exceeded for current billing plan (limit: ${limit}, used: ${used})`);
    }
  }

  async requireBillingEntitlements(orgId: string): Promise<{ entitlements: BillingEntitlementsRow; counts: OrganizationUsageCounts }> {
    const sub = await this.entitlements.getSubscriptionState(orgId);
    if (!sub) throw new ForbiddenError("Organization has no active billing subscription");
    if (!BILLING_MUTABLE_STATUSES.has(sub.status)) {
      throw new ForbiddenError(`Billing subscription is ${sub.status}. This action is not permitted.`);
    }
    const allEntitlements = await this.entitlements.getEffectiveEntitlements(orgId);
    const featureConfig: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(allEntitlements)) {
      featureConfig[k] = v.booleanValue ?? v.integerValue ?? v.decimalValue ?? v.stringValue ?? null;
    }
    const counts = await this.deps.repository.getOrganizationUsageCounts(orgId);
    const eventLimit = await this.entitlements.getEffectiveIntegerFeature(orgId, "quota.monthly_events");

    const entitlements: BillingEntitlementsRow = {
      subscription_id: sub.subscriptionId,
      subscription_status: sub.status as any,
      plan_id: sub.planId,
      plan_key: sub.planKey,
      plan_tier: sub.planTier,
      feature_config: featureConfig,
      event_limit_monthly: eventLimit,
      hard_cap: false,
    };

    return { entitlements, counts };
  }

  async enforceBillingLimit(
    orgId: string,
    capability: "member" | "environment" | "apiKey" | "sso" | "scim",
  ): Promise<{ entitlements: BillingEntitlementsRow; counts: OrganizationUsageCounts; maxMembers?: number }> {
    const { entitlements, counts } = await this.requireBillingEntitlements(orgId);

    if (capability === "member") {
      const maxMembers = await this.entitlements.getEffectiveIntegerFeature(orgId, "quota.members");
      this.assertWithinLimit("Member", counts.activeMembers + counts.pendingInvitations, maxMembers);
      return { entitlements, counts, maxMembers };
    }

    if (capability === "sso") {
      const ssoEnabled = await this.entitlements.getEffectiveBooleanFeature(orgId, "security.sso");
      if (!ssoEnabled) {
        throw new ForbiddenError("SSO is not enabled for current billing plan");
      }
      this.assertWithinLimit("SSO provider", counts.ssoProviders, 1);
    }

    if (capability === "scim") {
      const scimEnabled = await this.entitlements.getEffectiveBooleanFeature(orgId, "security.scim");
      if (!scimEnabled) {
        throw new ForbiddenError("SCIM is not enabled for current billing plan");
      }
      this.assertWithinLimit("SCIM token", counts.scimTokens, 1);
    }

    return { entitlements, counts };
  }

  async createQuotaRequest(meta: RequestMeta, orgId: string, data: { quotaType: string; currentLimit: number; requestedLimit: number; reason: string }) {
    await this.deps.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "admin");
    const qr = await this.deps.repository.createQuotaRequest(orgId, data.quotaType, data.currentLimit, data.requestedLimit, data.reason);
    await this.deps.audit(meta, { orgId, action: "quota.requested", entityType: "quota_request", entityId: qr.id });
    return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at } as QuotaRequestDto;
  }

  async approveQuotaRequest(meta: RequestMeta, orgId: string, requestId: string, notes?: string) {
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    const qr = await this.deps.repository.reviewQuotaRequest(orgId, requestId, "approved", meta.actorUserId, notes);
    this.entitlements.invalidateOrgCache(orgId);
    await this.deps.audit(meta, { orgId, action: "quota.approved", entityType: "quota_request", entityId: requestId });
    return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at } as QuotaRequestDto;
  }

  async rejectQuotaRequest(meta: RequestMeta, orgId: string, requestId: string, notes?: string) {
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    const qr = await this.deps.repository.reviewQuotaRequest(orgId, requestId, "rejected", meta.actorUserId, notes);
    await this.deps.audit(meta, { orgId, action: "quota.rejected", entityType: "quota_request", entityId: requestId });
    return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at } as QuotaRequestDto;
  }

  async listQuotaRequests(orgId: string, userId: string, q: CursorPaginationQuery) {
    await this.deps.requireMember(orgId, userId, "admin");
    const result = await this.deps.repository.listQuotaRequests(orgId, q);
    return { data: result.data.map(qr => ({ id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at }) as QuotaRequestDto), meta: result.meta };
  }
}
