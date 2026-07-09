import { NotFoundError, OrgStatusError } from "../shared/errors.js";
// Helper function to map to DTO
export function toOrgDto(row) {
    return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        logoUrl: row.logo_url,
        websiteUrl: row.website_url,
        industry: row.industry,
        companySize: row.company_size,
        country: row.country,
        timezone: row.timezone,
        billingEmail: row.billing_email,
        supportEmail: row.support_email,
        ownerUserId: row.owner_user_id,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
export function toSettingsDto(row) {
    return {
        enforceSso: row.enforce_sso,
        enforceMfa: row.enforce_mfa,
        sessionTimeoutMinutes: row.session_timeout_minutes,
        dataRegion: row.data_region,
        dataRetentionDays: row.data_retention_days,
        auditLogRetentionDays: row.audit_log_retention_days,
        allowPublicProjects: row.allow_public_projects,
    };
}
export function isMutableOrg(status) {
    return ["active", "suspended"].includes(status);
}
export class CoreService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async requireMutableOrg(orgId) {
        const org = await this.deps.repository.findOrgById(orgId);
        if (!org)
            throw new NotFoundError("Organization");
        if (!isMutableOrg(org.status))
            throw new OrgStatusError(org.status);
        return org;
    }
    async createOrganization(meta, data) {
        const provisioned = await this.deps.repository.createOrg(data.name, meta.actorUserId, data);
        const org = provisioned.organization;
        await this.deps.audit(meta, {
            orgId: org.id,
            action: "org.created",
            entityType: "organization",
            entityId: org.id,
            entityName: org.name,
            newValues: {
                name: org.name,
                slug: org.slug,
                billing: {
                    planId: provisioned.planId,
                    subscriptionId: provisioned.subscriptionId,
                    provider: "system",
                    status: "active"
                }
            }
        });
        return toOrgDto(org);
    }
    async switchOrganization(meta, orgId) {
        await this.deps.requireMember(orgId, meta.actorUserId);
        const org = await this.deps.repository.findOrgById(orgId);
        if (!org)
            throw new NotFoundError("Organization");
        await this.deps.repository.setUserCurrentOrg(meta.actorUserId, orgId);
        await this.deps.audit(meta, {
            orgId,
            action: "org.switched",
            entityType: "organization",
            entityId: orgId,
            entityName: org.name,
            newValues: { currentOrgId: orgId },
        });
        return toOrgDto(org);
    }
    async getOrganization(orgId, userId) {
        await this.deps.requireMember(orgId, userId);
        const org = await this.deps.repository.findOrgById(orgId);
        if (!org)
            throw new NotFoundError("Organization");
        return toOrgDto(org);
    }
    async getOrganizationBySlug(slug, userId) {
        const org = await this.deps.repository.findOrgBySlug(slug);
        if (!org)
            throw new NotFoundError("Organization");
        await this.deps.requireMember(org.id, userId);
        return toOrgDto(org);
    }
    async updateOrganization(meta, orgId, data) {
        const oldOrg = await this.requireMutableOrg(orgId);
        await this.deps.requireMember(orgId, meta.actorUserId, "admin");
        const updated = await this.deps.repository.updateOrg(orgId, data);
        const changed = Object.keys(data).filter(k => data[k] !== undefined);
        await this.deps.audit(meta, { orgId, action: "org.updated", entityType: "organization", entityId: orgId, entityName: updated.name, oldValues: { name: oldOrg.name }, newValues: { name: updated.name }, changedFields: changed });
        return toOrgDto(updated);
    }
    async deleteOrganization(meta, orgId) {
        await this.requireMutableOrg(orgId);
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        // Capture key hashes before the cascade so we can purge the ingestion cache.
        let keyHashes = [];
        if (this.deps.listOrgApiKeyHashes) {
            keyHashes = await this.deps.listOrgApiKeyHashes(orgId);
        }
        else {
            keyHashes = await this.deps.repository.listOrgApiKeyHashes(orgId);
        }
        await this.deps.repository.softDeleteOrg(orgId);
        // Evict every project API key of this org from the in-process ingestion
        // cache so a deleted org stops ingesting immediately (not after TTL).
        if (this.deps.deleteApiKeyCache) {
            for (const hash of keyHashes) {
                try {
                    this.deps.deleteApiKeyCache(hash);
                }
                catch { /* best-effort */ }
            }
        }
        await this.deps.audit(meta, { orgId, action: "org.deleted", entityType: "organization", entityId: orgId, isSensitive: true });
    }
    async archiveOrganization(meta, orgId) {
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        await this.deps.repository.archiveOrg(orgId);
        await this.deps.audit(meta, { orgId, action: "org.archived", entityType: "organization", entityId: orgId });
    }
    async restoreOrganization(meta, orgId) {
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        const org = await this.deps.repository.restoreOrg(orgId);
        await this.deps.audit(meta, { orgId, action: "org.restored", entityType: "organization", entityId: orgId });
        return toOrgDto(org);
    }
    async transferOwnership(meta, orgId, newOwnerUserId) {
        await this.requireMutableOrg(orgId);
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        await this.deps.requireMember(orgId, newOwnerUserId);
        await this.deps.repository.transferOwnership(orgId, meta.actorUserId, newOwnerUserId);
        await this.deps.audit(meta, { orgId, action: "org.ownership_transferred", entityType: "organization", entityId: orgId, newValues: { newOwner: newOwnerUserId }, isSensitive: true });
    }
    async getSettings(orgId, userId) {
        await this.deps.requireMember(orgId, userId, "admin");
        const s = await this.deps.repository.getSettings(orgId);
        if (!s)
            throw new NotFoundError("Settings");
        return toSettingsDto(s);
    }
    async updateSettings(meta, orgId, data) {
        await this.requireMutableOrg(orgId);
        await this.deps.requireMember(orgId, meta.actorUserId, "admin");
        const s = await this.deps.repository.updateSettings(orgId, data);
        const changed = Object.keys(data).filter(k => data[k] !== undefined);
        await this.deps.audit(meta, { orgId, action: "settings.updated", entityType: "organization_settings", entityId: orgId, changedFields: changed, newValues: changed.reduce((acc, k) => ({ ...acc, [k]: data[k] }), {}) });
        return toSettingsDto(s);
    }
    async checkSlugAvailability(slug) {
        const available = await this.deps.repository.isSlugAvailable(slug);
        return { slug, available };
    }
    async listUserOrganizations(userId, q) {
        const result = await this.deps.repository.listUserOrganizations(userId, q);
        return {
            data: result.data.map((r) => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, role: r.role, status: r.status, createdAt: r.created_at })),
            meta: result.meta
        };
    }
}
//# sourceMappingURL=core.service.js.map