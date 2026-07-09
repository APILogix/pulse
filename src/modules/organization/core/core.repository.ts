import { BaseRepository, cursorPage } from "../shared/base.repository.js";
import { NotFoundError, ConflictError } from "../shared/errors.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { 
  OrganizationRow, 
  OrgSettingsRow, 
  OrganizationProvisioningResult 
} from "./core.schema.js";

// Helper for generating base slugs
function generateSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export class CoreRepository extends BaseRepository {
  async createOrg(
    name: string, ownerUserId: string, data: {
      description?: string | null; industry?: string | null; companySize?: string | null;
      country?: string | null; timezone?: string; billingEmail?: string | null;
    }
  ): Promise<OrganizationProvisioningResult> {
    return this.withTransaction(async (client) => {
      const dup = await client.query<{ x: boolean }>(
        `SELECT EXISTS(SELECT 1 FROM organizations WHERE owner_user_id=$1 AND deleted_at IS NULL) AS x`, [ownerUserId]
      );
      if (dup.rows[0]?.x) throw new ConflictError("User already owns an organization");

      let slug = generateSlug(name);
      let i = 1;
      while (true) {
        const c = await client.query<{ x: boolean }>(
          `SELECT EXISTS(SELECT 1 FROM organizations WHERE slug=$1 AND deleted_at IS NULL) AS x`, [slug]
        );
        if (!c.rows[0]?.x) break;
        slug = `${generateSlug(name)}-${i++}`;
      }

      const r = await client.query<OrganizationRow>(
        `INSERT INTO organizations (name,slug,description,industry,company_size,country,timezone,billing_email,owner_user_id,created_by,status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,'active')
         RETURNING id,name,slug,description,logo_url,website_url,industry,company_size,country,timezone,billing_email,support_email,owner_user_id,created_by,status,deleted_at,created_at,updated_at`,
        [name, slug, data.description??null, data.industry??null, data.companySize??null, data.country??null, data.timezone??'UTC', data.billingEmail??null, ownerUserId]
      );
      const org = r.rows[0]!;

      await client.query(`INSERT INTO organization_settings (org_id) VALUES ($1)`, [org.id]);

      await client.query(
        `INSERT INTO organization_members (org_id,user_id,role,status,joined_at,joined_method,last_active_at)
         VALUES ($1,$2,'owner','active',NOW(),'admin_add',NOW())`,
        [org.id, ownerUserId]
      );

      await client.query(
        `UPDATE users SET current_org_id=$1, updated_at=NOW() WHERE id=$2`,
        [org.id, ownerUserId],
      );

      const plan = await client.query<{ id: string }>(
        `SELECT id
         FROM plans
         WHERE tier = 'enterprise' AND is_active = TRUE
         ORDER BY version DESC, sort_order ASC
         LIMIT 1
         FOR SHARE`,
      );
      const freePlanId = plan.rows[0]?.id;
      if (!freePlanId) throw new NotFoundError("Free billing plan");

      const periodStart = new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

      const subscription = await client.query<{ id: string }>(
        `INSERT INTO organization_subscriptions (
           org_id,
           plan_id,
           status,
           billing_provider,
           billing_interval,
           current_period_start,
           current_period_end,
           cancel_at_period_end,
           seats
         )
         VALUES ($1,$2,'active','system','monthly',$3,$4,FALSE,1)
         RETURNING id`,
        [org.id, freePlanId, periodStart, periodEnd],
      );
      const subscriptionId = subscription.rows[0]!.id;

      await client.query(
        `INSERT INTO subscription_events (
           org_id,
           subscription_id,
           event_type,
           new_plan_id,
           actor,
           metadata
         )
         VALUES ($1,$2,'created',$3,'system',$4)`,
        [
          org.id,
          subscriptionId,
          freePlanId,
          JSON.stringify({ reason: "organization_created", provisionedBy: "organization.create" }),
        ],
      );

      await client.query(
        `INSERT INTO usage_daily_counters (
           org_id,
           project_id,
           date,
           events_count,
           ai_analyses_count
         )
         VALUES ($1,NULL,CURRENT_DATE,0,0)
         ON CONFLICT (
           org_id,
           (COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid)),
           date
         )
         DO NOTHING`,
        [org.id],
      );

      return { organization: org, subscriptionId, planId: freePlanId };
    });
  }

  async setUserCurrentOrg(userId: string, orgId: string): Promise<void> {
    await this.db.query(
      `UPDATE users SET current_org_id=$1, updated_at=NOW() WHERE id=$2 AND deleted_at IS NULL`,
      [orgId, userId],
    );
  }

  async findOrgById(id: string, includeDeleted = false): Promise<OrganizationRow | null> {
    const r = await this.db.query<OrganizationRow>(
      `SELECT id,name,slug,description,logo_url,website_url,industry,company_size,country,timezone,billing_email,support_email,owner_user_id,created_by,status,deleted_at,created_at,updated_at
       FROM organizations WHERE id=$1 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`, [id]
    );
    return r.rows[0] ?? null;
  }

  async findOrgBySlug(slug: string): Promise<OrganizationRow | null> {
    const r = await this.db.query<OrganizationRow>(
      `SELECT id,name,slug,description,logo_url,website_url,industry,company_size,country,timezone,billing_email,support_email,owner_user_id,created_by,status,deleted_at,created_at,updated_at
       FROM organizations WHERE slug=$1 AND deleted_at IS NULL`, [slug]
    );
    return r.rows[0] ?? null;
  }

  async updateOrg(id: string, data: Record<string, unknown>): Promise<OrganizationRow> {
    return this.withTransaction(async (client) => {
      const cols: string[] = []; const vals: unknown[] = [];
      const map: Record<string,string> = {
        name:'name', description:'description', logoUrl:'logo_url', websiteUrl:'website_url',
        industry:'industry', companySize:'company_size', country:'country', timezone:'timezone',
        billingEmail:'billing_email', supportEmail:'support_email'
      };
      for (const [k,v] of Object.entries(data)) {
        if (v !== undefined && map[k]) { cols.push(`${map[k]}=$${cols.length+1}`); vals.push(v); }
      }
      if (cols.length === 0) throw new ConflictError("No fields to update");
      vals.push(id);
      const r = await client.query<OrganizationRow>(
        `UPDATE organizations SET ${cols.join(',')} WHERE id=$${vals.length} AND deleted_at IS NULL
         RETURNING id,name,slug,description,logo_url,website_url,industry,company_size,country,timezone,billing_email,support_email,owner_user_id,created_by,status,deleted_at,created_at,updated_at`, vals
      );
      if (!r.rows[0]) throw new NotFoundError("Organization");
      return r.rows[0];
    });
  }

  async softDeleteOrg(id: string): Promise<void> {
    return this.withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE organizations SET deleted_at=NOW(),status='archived' WHERE id=$1 AND deleted_at IS NULL`, [id]
      );
      if (r.rowCount === 0) throw new NotFoundError("Organization");
      // Cascade: revoke all project API keys and pause projects so a deleted
      // org cannot keep ingesting or be operated on. Tables FK ON DELETE
      // CASCADE only fires on hard delete, which we never do (soft delete only).
      await client.query(
        `UPDATE project_api_keys k
         SET is_active=FALSE, revoked_at=NOW(), revoked_reason='org_deleted'
         FROM projects p
         WHERE k.project_id=p.id AND p.org_id=$1 AND k.is_active=TRUE`, [id]
      );
      await client.query(
        `UPDATE projects SET status='archived', is_active=FALSE
         WHERE org_id=$1 AND deleted_at IS NULL AND status<>'archived'`, [id]
      );
    });
  }

  async listOrgApiKeyHashes(orgId: string): Promise<string[]> {
    const r = await this.db.query<{ key_hash: string }>(
      `SELECT k.key_hash
       FROM project_api_keys k
       JOIN projects p ON p.id=k.project_id
       WHERE p.org_id=$1`, [orgId]
    );
    return r.rows.map(row => row.key_hash);
  }

  async archiveOrg(id: string): Promise<void> {
    const r = await this.db.query(`UPDATE organizations SET status='archived',updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL`, [id]);
    if (r.rowCount === 0) throw new NotFoundError("Organization");
  }

  async restoreOrg(id: string): Promise<OrganizationRow> {
    const r = await this.db.query<OrganizationRow>(
      `UPDATE organizations SET status='active',updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL
       RETURNING id,name,slug,description,logo_url,website_url,industry,company_size,country,timezone,billing_email,support_email,owner_user_id,created_by,status,deleted_at,created_at,updated_at`, [id]
    );
    if (!r.rows[0]) throw new NotFoundError("Organization");
    return r.rows[0];
  }

  async transferOwnership(orgId: string, oldOwnerId: string, newOwnerId: string): Promise<void> {
    return this.withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE organizations SET owner_user_id=$1,updated_at=NOW() WHERE id=$2 AND owner_user_id=$3 AND deleted_at IS NULL`,
        [newOwnerId, orgId, oldOwnerId]
      );
      if (r.rowCount === 0) throw new ConflictError("Invalid ownership transfer");
      await client.query(`UPDATE organization_members SET role='owner',updated_at=NOW() WHERE org_id=$1 AND user_id=$2`, [orgId, newOwnerId]);
      await client.query(`UPDATE organization_members SET role='admin',updated_at=NOW() WHERE org_id=$1 AND user_id=$2`, [orgId, oldOwnerId]);
    });
  }

  async getSettings(orgId: string): Promise<OrgSettingsRow | null> {
    const r = await this.db.query<OrgSettingsRow>(
      `SELECT org_id,enforce_sso,enforce_mfa,session_timeout_minutes,data_region,data_retention_days,audit_log_retention_days,allow_public_projects,created_at,updated_at
       FROM organization_settings WHERE org_id=$1`, [orgId]
    );
    return r.rows[0] ?? null;
  }

  async updateSettings(orgId: string, data: Record<string, unknown>): Promise<OrgSettingsRow> {
    const cols: string[] = []; const vals: unknown[] = [];
    const map: Record<string,string> = {
      enforceSso:'enforce_sso', enforceMfa:'enforce_mfa', sessionTimeoutMinutes:'session_timeout_minutes',
      dataRegion:'data_region', dataRetentionDays:'data_retention_days', auditLogRetentionDays:'audit_log_retention_days',
      allowPublicProjects:'allow_public_projects'
    };
    for (const [k,v] of Object.entries(data)) {
      if (v !== undefined && map[k]) { cols.push(`${map[k]}=$${cols.length+1}`); vals.push(v); }
    }
    if (cols.length === 0) throw new ConflictError("No fields to update");
    vals.push(orgId);
    const r = await this.db.query<OrgSettingsRow>(
      `UPDATE organization_settings SET ${cols.join(',')},updated_at=NOW() WHERE org_id=$${vals.length}
       RETURNING org_id,enforce_sso,enforce_mfa,session_timeout_minutes,data_region,data_retention_days,audit_log_retention_days,allow_public_projects,created_at,updated_at`, vals
    );
    if (!r.rows[0]) throw new NotFoundError("Settings");
    return r.rows[0];
  }

  async isSlugAvailable(slug: string): Promise<boolean> {
    const r = await this.db.query<{ x: boolean }>(`SELECT EXISTS(SELECT 1 FROM organizations WHERE slug=$1 AND deleted_at IS NULL) AS x`, [slug]);
    return !r.rows[0]?.x;
  }

  async listUserOrganizations(userId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<any>> {
    const params: unknown[] = [userId];
    let where = `om.user_id=$1 AND om.status='active' AND o.deleted_at IS NULL`;
    if (q.cursor) { params.push(q.cursor); where += ` AND o.created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<any>(
      `SELECT o.id,o.name,o.slug,o.logo_url,om.role,o.status,o.created_at
       FROM organizations o JOIN organization_members om ON o.id=om.org_id
       WHERE ${where} ORDER BY o.created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }
}
