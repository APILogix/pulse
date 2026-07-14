import type { FastifyBaseLogger } from "fastify";
import { NotFoundError, OrgStatusError } from "../shared/errors.js";
import type { RequestMeta, CursorPaginationQuery, OrgRole } from "../shared/types.js";
import type { CoreRepository } from "./core.repository.js";
import { BillingProvisioningService } from "../../billing/provisioning/service.js";
import type { OrganizationRow, OrgSettingsRow, OrganizationDto, OrgSettingsDto, UserOrganizationDto } from "./core.schema.js";

// Helper function to map to DTO
export function toOrgDto(row: OrganizationRow): OrganizationDto {
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

export function toSettingsDto(row: OrgSettingsRow): OrgSettingsDto {
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

export function isMutableOrg(status: string): boolean {
  return ["active", "suspended"].includes(status);
}

export interface CoreServiceDeps {
  repository: CoreRepository;
  log: FastifyBaseLogger;
  requireMember: (orgId: string, userId: string, minRole?: OrgRole) => Promise<any>;
  audit: (meta: RequestMeta, data: any) => Promise<void>;
  listOrgApiKeyHashes?: (orgId: string) => Promise<string[]>; // for cascading delete caching
  deleteApiKeyCache?: (hash: string) => void;
  billingProvisioning: BillingProvisioningService;
}

export class CoreService {
  constructor(private deps: CoreServiceDeps) {}

  public async requireMutableOrg(orgId: string) {
    const org = await this.deps.repository.findOrgById(orgId);
    if (!org) throw new NotFoundError("Organization");
    if (!isMutableOrg(org.status)) throw new OrgStatusError(org.status);
    return org;
  }

  async createOrganization(meta: RequestMeta, data: { name: string; description?: string; industry?: string; companySize?: string; country?: string; timezone?: string; billingEmail?: string }) {
    const provisioned = await this.deps.repository.withTransaction(async (client) => {
      // 1. Create organization (defaults to 'trialing' per canonical schema)
      const created = await this.deps.repository.createOrg(client, data.name, meta.actorUserId, data, 'trialing');

      // 2. Billing provisioning: creates subscription, subscription_events, and usage_current_period
      const billing = await this.deps.billingProvisioning.provisionFreeSubscription(client, created.organization.id);

      // 3. Sync org status with the billing subscription status
      //    (e.g. 'active' if free plan has trial_days=0, 'trialing' if trial_days>0)
      if (billing.status !== 'trialing') {
        await client.query(
          `UPDATE organizations SET status=$1, updated_at=NOW() WHERE id=$2`,
          [billing.status, created.organization.id],
        );
        created.organization.status = billing.status as any;
      }

      // 4. Audit log
      await client.query(
        `INSERT INTO organization_audit_logs (
           org_id, actor_user_id, actor_email, actor_ip, actor_user_agent, actor_session_id,
           action, entity_type, entity_id, entity_name, request_id, http_method, endpoint,
           new_values, status, metadata
         ) VALUES (
           $1, $2, $3, $4::inet, $5, $6::uuid,
           'organization.created', 'organization', $1, $7, $8::uuid, $9, $10,
           $11::jsonb, 'success', $12::jsonb
         )`,
        [
          created.organization.id, meta.actorUserId, meta.actorEmail, meta.actorIp || null,
          meta.actorUserAgent, meta.actorSessionId || null, created.organization.name,
          meta.requestId || null, meta.httpMethod || null, meta.endpoint || null,
          JSON.stringify({ name: created.organization.name, slug: created.organization.slug, billing }),
          JSON.stringify({ source: 'organization.create' }),
        ],
      );
      return created.organization;
    });
    return toOrgDto(provisioned);
  }

  async switchOrganization(meta: RequestMeta, orgId: string) {
    await this.deps.requireMember(orgId, meta.actorUserId);
    const org = await this.deps.repository.findOrgById(orgId);
    if (!org) throw new NotFoundError("Organization");

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

  async getOrganization(orgId: string, userId: string) {
    await this.deps.requireMember(orgId, userId);
    const org = await this.deps.repository.findOrgById(orgId);
    if (!org) throw new NotFoundError("Organization");
    return toOrgDto(org);
  }

  async getOrganizationBySlug(slug: string, userId: string) {
    const org = await this.deps.repository.findOrgBySlug(slug);
    if (!org) throw new NotFoundError("Organization");
    await this.deps.requireMember(org.id, userId);
    return toOrgDto(org);
  }

  async updateOrganization(meta: RequestMeta, orgId: string, data: Record<string, unknown>) {
    const oldOrg = await this.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "admin");
    const updated = await this.deps.repository.updateOrg(orgId, data);
    const changed = Object.keys(data).filter(k => data[k] !== undefined);
    await this.deps.audit(meta, { orgId, action: "org.updated", entityType: "organization", entityId: orgId, entityName: updated.name, oldValues: { name: oldOrg.name }, newValues: { name: updated.name }, changedFields: changed });
    return toOrgDto(updated);
  }

  async deleteOrganization(meta: RequestMeta, orgId: string) {
    await this.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    
    // Capture key hashes before the cascade so we can purge the ingestion cache.
    let keyHashes: string[] = [];
    if (this.deps.listOrgApiKeyHashes) {
      keyHashes = await this.deps.listOrgApiKeyHashes(orgId);
    } else {
      keyHashes = await this.deps.repository.listOrgApiKeyHashes(orgId);
    }
    
    await this.deps.repository.softDeleteOrg(orgId);
    
    // Evict every project API key of this org from the in-process ingestion
    // cache so a deleted org stops ingesting immediately (not after TTL).
    if (this.deps.deleteApiKeyCache) {
      for (const hash of keyHashes) {
        try { this.deps.deleteApiKeyCache(hash); } catch { /* best-effort */ }
      }
    }
    await this.deps.audit(meta, { orgId, action: "org.deleted", entityType: "organization", entityId: orgId, isSensitive: true });
  }

  async archiveOrganization(meta: RequestMeta, orgId: string) {
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    await this.deps.repository.archiveOrg(orgId);
    await this.deps.audit(meta, { orgId, action: "org.archived", entityType: "organization", entityId: orgId });
  }

  async restoreOrganization(meta: RequestMeta, orgId: string) {
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    const org = await this.deps.repository.restoreOrg(orgId);
    await this.deps.audit(meta, { orgId, action: "org.restored", entityType: "organization", entityId: orgId });
    return toOrgDto(org);
  }

  async transferOwnership(meta: RequestMeta, orgId: string, newOwnerUserId: string) {
    await this.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "owner");
    await this.deps.requireMember(orgId, newOwnerUserId);
    await this.deps.repository.transferOwnership(orgId, meta.actorUserId, newOwnerUserId);
    await this.deps.audit(meta, { orgId, action: "org.ownership_transferred", entityType: "organization", entityId: orgId, newValues: { newOwner: newOwnerUserId }, isSensitive: true });
  }

  async getSettings(orgId: string, userId: string) {
    await this.deps.requireMember(orgId, userId, "admin");
    const s = await this.deps.repository.getSettings(orgId);
    if (!s) throw new NotFoundError("Settings");
    return toSettingsDto(s);
  }

  async updateSettings(meta: RequestMeta, orgId: string, data: Record<string, unknown>) {
    await this.requireMutableOrg(orgId);
    await this.deps.requireMember(orgId, meta.actorUserId, "admin");
    const s = await this.deps.repository.updateSettings(orgId, data);
    const changed = Object.keys(data).filter(k => data[k] !== undefined);
    await this.deps.audit(meta, { orgId, action: "settings.updated", entityType: "organization_settings", entityId: orgId, changedFields: changed, newValues: changed.reduce((acc, k) => ({ ...acc, [k]: (data as any)[k] }), {}) });
    return toSettingsDto(s);
  }

  async checkSlugAvailability(slug: string) {
    const available = await this.deps.repository.isSlugAvailable(slug);
    return { slug, available };
  }

  async listUserOrganizations(userId: string, q: CursorPaginationQuery) {
    const result = await this.deps.repository.listUserOrganizations(userId, q);
    return {
      data: result.data.map((r: any) => ({ id: r.id, name: r.name, slug: r.slug, logoUrl: r.logo_url, role: r.role, status: r.status, createdAt: r.created_at }) as UserOrganizationDto),
      meta: result.meta
    };
  }
}
