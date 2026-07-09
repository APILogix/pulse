export class SsoService {
    deps;
    constructor(deps) {
        this.deps = deps;
    }
    async listSsoProviders(orgId, userId) {
        await this.deps.requireMember(orgId, userId, "admin");
        const rows = await this.deps.repository.listSsoProviders(orgId);
        return rows.map(sso => ({ id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at }));
    }
    async createSsoProvider(meta, orgId, data) {
        await this.deps.requireMutableOrg(orgId);
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        await this.deps.enforceBillingLimit(orgId, "sso");
        const sso = await this.deps.repository.createSsoProvider(orgId, data);
        await this.deps.audit(meta, { orgId, action: "sso.created", entityType: "sso_provider", entityId: sso.id, isSensitive: true });
        return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at };
    }
    async updateSsoProvider(meta, orgId, ssoId, data) {
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        const sso = await this.deps.repository.updateSsoProvider(orgId, ssoId, data);
        await this.deps.audit(meta, { orgId, action: "sso.updated", entityType: "sso_provider", entityId: ssoId });
        return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at };
    }
    async deleteSsoProvider(meta, orgId, ssoId) {
        await this.deps.requireMember(orgId, meta.actorUserId, "owner");
        await this.deps.repository.deleteSsoProvider(orgId, ssoId);
        await this.deps.audit(meta, { orgId, action: "sso.deleted", entityType: "sso_provider", entityId: ssoId, isSensitive: true });
    }
}
//# sourceMappingURL=sso.service.js.map