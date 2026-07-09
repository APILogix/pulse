import type { SsoRepository } from "./sso.repository.js";
import type { RequestMeta, OrgMemberRow, OrganizationRow, OrgRole } from "../types.js";
import type { BillingEntitlementsRow, OrganizationUsageCounts } from "../repository.js";

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

export interface SsoServiceDependencies {
  repository: SsoRepository;
  requireMutableOrg: (orgId: string) => Promise<OrganizationRow>;
  requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<OrgMemberRow>;
  enforceBillingLimit: (orgId: string, limitKey: "apiKey" | "scim" | "member" | "environment" | "sso") => Promise<{ entitlements: BillingEntitlementsRow; counts: OrganizationUsageCounts; maxMembers?: number; }>;
  audit: (meta: RequestMeta, payload: any) => Promise<void>;
}

export class SsoService {
  constructor(private readonly deps: SsoServiceDependencies) {}

  async listSsoProviders(orgId: string, userId: string) {
    await this.deps.requireMember(orgId, userId, "admin");
    const rows = await this.deps.repository.listSsoProviders(orgId);
    return rows.map(sso => ({ id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at }) as SsoProviderDto);
  }

  async createSsoProvider(meta: RequestMeta, orgId: string, data: Record<string, unknown>) {
    await this.deps.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    await this.deps.enforceBillingLimit(orgId, "sso");
    const sso = await this.deps.repository.createSsoProvider(orgId, data);
    await this.deps.audit(meta, { orgId, action: "sso.created", entityType: "sso_provider", entityId: sso.id, isSensitive: true });
    return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at } as SsoProviderDto;
  }

  async updateSsoProvider(meta: RequestMeta, orgId: string, ssoId: string, data: Record<string, unknown>) {
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    const sso = await this.deps.repository.updateSsoProvider(orgId, ssoId, data);
    await this.deps.audit(meta, { orgId, action: "sso.updated", entityType: "sso_provider", entityId: ssoId });
    return { id: sso.id, providerName: sso.provider_name, providerType: sso.provider_type, entityId: sso.entity_id, ssoUrl: sso.sso_url, domain: sso.domain, isActive: sso.is_active, createdAt: sso.created_at } as SsoProviderDto;
  }

  async deleteSsoProvider(meta: RequestMeta, orgId: string, ssoId: string) {
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    await this.deps.repository.deleteSsoProvider(orgId, ssoId);
    await this.deps.audit(meta, { orgId, action: "sso.deleted", entityType: "sso_provider", entityId: ssoId, isSensitive: true });
  }
}
