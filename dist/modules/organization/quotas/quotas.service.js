import { ForbiddenError } from "../shared/errors.js";
const BILLING_MUTABLE_STATUSES = new Set(["active", "trialing", "past_due"]);
export class QuotasService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    limitFrom(entitlements, keys, fallback = Number.POSITIVE_INFINITY) {
        const config = entitlements.feature_config ?? {};
        for (const key of keys) {
            const raw = config[key];
            if (typeof raw === "number")
                return raw;
            if (typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw)))
                return Number(raw);
        }
        return fallback;
    }
    featureAllowed(entitlements, keys, fallback = true) {
        const config = entitlements.feature_config ?? {};
        for (const key of keys) {
            const raw = config[key];
            if (typeof raw === "boolean")
                return raw;
            if (typeof raw === "string")
                return raw.toLowerCase() === "true";
        }
        return fallback;
    }
    assertWithinLimit(name, used, limit) {
        if (limit >= 0 && Number.isFinite(limit) && used >= limit) {
            throw new ForbiddenError(`${name} limit exceeded for current billing plan`);
        }
    }
    async requireBillingEntitlements(orgId) {
        const entitlements = await this.deps.repository.getBillingEntitlements(orgId);
        if (!entitlements)
            throw new ForbiddenError("Organization has no active billing subscription");
        if (!BILLING_MUTABLE_STATUSES.has(entitlements.subscription_status)) {
            throw new ForbiddenError(`Billing subscription is ${entitlements.subscription_status}. This action is not permitted.`);
        }
        const counts = await this.deps.repository.getOrganizationUsageCounts(orgId);
        return { entitlements, counts };
    }
    async enforceBillingLimit(orgId, capability) {
        const { entitlements, counts } = await this.requireBillingEntitlements(orgId);
        if (capability === "member") {
            const maxMembers = this.limitFrom(entitlements, ["max_team_members", "max_members"]);
            this.assertWithinLimit("Member", counts.activeMembers + counts.pendingInvitations, maxMembers);
            return { entitlements, counts, maxMembers };
        }
        if (capability === "sso") {
            if (!this.featureAllowed(entitlements, ["sso_saml", "sso_enabled", "saml_sso"], false)) {
                throw new ForbiddenError("SSO is not enabled for current billing plan");
            }
            this.assertWithinLimit("SSO provider", counts.ssoProviders, this.limitFrom(entitlements, ["max_sso_providers", "sso_providers_max"], 1));
        }
        if (capability === "scim") {
            if (!this.featureAllowed(entitlements, ["scim", "scim_enabled"], false)) {
                throw new ForbiddenError("SCIM is not enabled for current billing plan");
            }
            this.assertWithinLimit("SCIM token", counts.scimTokens, this.limitFrom(entitlements, ["max_scim_tokens", "scim_tokens_max"], 1));
        }
        return { entitlements, counts };
    }
    async createQuotaRequest(meta, orgId, data) {
        await this.deps.requireMutableOrg(orgId);
        await this.deps.requireMember(orgId, meta.actorUserId, "admin");
        const qr = await this.deps.repository.createQuotaRequest(orgId, data.quotaType, data.currentLimit, data.requestedLimit, data.reason);
        await this.deps.audit(meta, { orgId, action: "quota.requested", entityType: "quota_request", entityId: qr.id });
        return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at };
    }
    async approveQuotaRequest(meta, orgId, requestId, notes) {
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        const qr = await this.deps.repository.reviewQuotaRequest(orgId, requestId, "approved", meta.actorUserId, notes);
        await this.deps.audit(meta, { orgId, action: "quota.approved", entityType: "quota_request", entityId: requestId });
        return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at };
    }
    async rejectQuotaRequest(meta, orgId, requestId, notes) {
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        const qr = await this.deps.repository.reviewQuotaRequest(orgId, requestId, "rejected", meta.actorUserId, notes);
        await this.deps.audit(meta, { orgId, action: "quota.rejected", entityType: "quota_request", entityId: requestId });
        return { id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at };
    }
    async listQuotaRequests(orgId, userId, q) {
        await this.deps.requireMember(orgId, userId, "admin");
        const result = await this.deps.repository.listQuotaRequests(orgId, q);
        return { data: result.data.map(qr => ({ id: qr.id, quotaType: qr.quota_type, currentLimit: qr.current_limit, requestedLimit: qr.requested_limit, reason: qr.reason, status: qr.status, reviewedAt: qr.reviewed_at, notes: qr.notes, createdAt: qr.created_at })), meta: result.meta };
    }
}
//# sourceMappingURL=quotas.service.js.map