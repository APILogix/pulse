import type { PoolClient } from "pg";
import { pool } from "../../config/database.js";
import { generateSlug, generateEnvSlug } from "./utils.js";
import {
  ConflictError, NotFoundError,
  type OrganizationRow, type OrgSettingsRow, type OrgMemberRow,
  type OrgInvitationRow, type AuditLogRow, type OrgEnvironmentRow,
  type OrgApiKeyRow, type OrgSsoProviderRow, type OrgScimTokenRow,
  type SecurityEventRow, type QuotaRequestRow, type UserOrgRow,
  type CreateAuditLogRecord, type CursorPaginationQuery,
  type CursorPaginatedResponse, type InvitationStatus,
} from "./types.js";

function pgErr(e: unknown): { code?: string } {
  return typeof e === "object" && e !== null ? (e as { code?: string }) : {};
}

function cursorPage<T extends { created_at: Date }>(
  rows: T[], limit: number
): CursorPaginatedResponse<T> {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    meta: {
      hasMore,
      nextCursor: hasMore && data.length > 0
        ? data[data.length - 1]!.created_at.toISOString()
        : null,
      limit,
    },
  };
}

export class OrganizationRepository {
  private readonly db = pool;

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Organization CRUD ──────────────────────────────
  async createOrg(
    name: string, ownerUserId: string, data: {
      description?: string; industry?: string; companySize?: string;
      country?: string; timezone?: string; billingEmail?: string;
    }
  ): Promise<OrganizationRow> {
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

      return org;
    });
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
    const r = await this.db.query(
      `UPDATE organizations SET deleted_at=NOW(),status='archived' WHERE id=$1 AND deleted_at IS NULL`, [id]
    );
    if (r.rowCount === 0) throw new NotFoundError("Organization");
  }

  async archiveOrg(id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organizations SET status='archived' WHERE id=$1 AND deleted_at IS NULL AND status NOT IN ('archived')`, [id]
    );
    if (r.rowCount === 0) throw new NotFoundError("Organization");
  }

  async restoreOrg(id: string): Promise<OrganizationRow> {
    const r = await this.db.query<OrganizationRow>(
      `UPDATE organizations SET deleted_at=NULL,status='active' WHERE id=$1
       RETURNING id,name,slug,description,logo_url,website_url,industry,company_size,country,timezone,billing_email,support_email,owner_user_id,created_by,status,deleted_at,created_at,updated_at`, [id]
    );
    if (!r.rows[0]) throw new NotFoundError("Organization");
    return r.rows[0];
  }

  async transferOwnership(orgId: string, fromId: string, toId: string): Promise<void> {
    return this.withTransaction(async (client) => {
      // Row-level lock prevents concurrent ownership transfers
      const r = await client.query(
        `UPDATE organizations SET owner_user_id=$1 WHERE id=$2 AND owner_user_id=$3 AND deleted_at IS NULL`, [toId, orgId, fromId]
      );
      if (r.rowCount === 0) throw new NotFoundError("Organization");
      // Demote old owner, promote new owner — order matters for constraint safety
      await client.query(
        `UPDATE organization_members SET role='admin' WHERE org_id=$1 AND user_id=$2 AND status='active'`, [orgId, fromId]
      );
      await client.query(
        `UPDATE organization_members SET role='owner' WHERE org_id=$1 AND user_id=$2 AND status='active'`, [orgId, toId]
      );
    });
  }

  // ── Settings ──────────────────────────────────────
  async getSettings(orgId: string): Promise<OrgSettingsRow | null> {
    const r = await this.db.query<OrgSettingsRow>(
      `SELECT org_id,enforce_sso,enforce_mfa,session_timeout_minutes,data_region,data_retention_days,audit_log_retention_days,allow_public_projects,created_at,updated_at
       FROM organization_settings WHERE org_id=$1`, [orgId]
    );
    return r.rows[0] ?? null;
  }

  async updateSettings(orgId: string, data: Record<string, unknown>): Promise<OrgSettingsRow> {
    const map: Record<string,string> = {
      enforceSso:'enforce_sso', enforceMfa:'enforce_mfa', sessionTimeoutMinutes:'session_timeout_minutes',
      dataRegion:'data_region', dataRetentionDays:'data_retention_days',
      auditLogRetentionDays:'audit_log_retention_days', allowPublicProjects:'allow_public_projects'
    };
    const cols: string[] = []; const vals: unknown[] = [];
    for (const [k,v] of Object.entries(data)) {
      if (v !== undefined && map[k]) { cols.push(`${map[k]}=$${cols.length+2}`); vals.push(v); }
    }
    if (cols.length === 0) throw new ConflictError("No fields to update");
    const r = await this.db.query<OrgSettingsRow>(
      `UPDATE organization_settings SET ${cols.join(',')} WHERE org_id=$1
       RETURNING org_id,enforce_sso,enforce_mfa,session_timeout_minutes,data_region,data_retention_days,audit_log_retention_days,allow_public_projects,created_at,updated_at`,
      [orgId, ...vals]
    );
    if (!r.rows[0]) throw new NotFoundError("Settings");
    return r.rows[0];
  }

  // ── Members ───────────────────────────────────────
  async findActiveMember(orgId: string, userId: string): Promise<OrgMemberRow | null> {
    const r = await this.db.query<OrgMemberRow>(
      `SELECT om.id,om.org_id,om.user_id,om.role,om.status,u.email,u.full_name,om.invited_by,om.invited_at,om.joined_at,om.joined_method,om.last_active_at,om.deactivated_at,om.deactivated_by,om.deactivation_reason,om.created_at,om.updated_at
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1 AND om.user_id=$2 AND om.status='active'`, [orgId, userId]
    );
    return r.rows[0] ?? null;
  }

  async findMember(orgId: string, userId: string): Promise<OrgMemberRow | null> {
    const r = await this.db.query<OrgMemberRow>(
      `SELECT om.id,om.org_id,om.user_id,om.role,om.status,u.email,u.full_name,om.invited_by,om.invited_at,om.joined_at,om.joined_method,om.last_active_at,om.deactivated_at,om.deactivated_by,om.deactivation_reason,om.created_at,om.updated_at
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1 AND om.user_id=$2`, [orgId, userId]
    );
    return r.rows[0] ?? null;
  }

  async getMemberRole(orgId: string, userId: string): Promise<string | null> {
    const r = await this.db.query<{ role: string }>(
      `SELECT role FROM organization_members WHERE org_id=$1 AND user_id=$2 AND status='active'`, [orgId, userId]
    );
    return r.rows[0]?.role ?? null;
  }

  async listMembers(orgId: string, q: CursorPaginationQuery, filters?: { status?: string; role?: string }): Promise<CursorPaginatedResponse<OrgMemberRow>> {
    const params: unknown[] = [orgId];
    let where = `om.org_id=$1`;
    if (filters?.status) { params.push(filters.status); where += ` AND om.status=$${params.length}`; }
    if (filters?.role) { params.push(filters.role); where += ` AND om.role=$${params.length}`; }
    if (q.search) { params.push(`%${q.search}%`); where += ` AND (u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`; }
    if (q.cursor) { params.push(q.cursor); where += ` AND om.created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<OrgMemberRow>(
      `SELECT om.id,om.org_id,om.user_id,om.role,om.status,u.email,u.full_name,om.invited_by,om.invited_at,om.joined_at,om.joined_method,om.last_active_at,om.deactivated_at,om.deactivated_by,om.deactivation_reason,om.created_at,om.updated_at
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE ${where} ORDER BY om.created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  async addMember(orgId: string, userId: string, role: string, invitedBy: string, method: string): Promise<OrgMemberRow> {
    return this.withTransaction(async (client) => {
      const r = await client.query<{ id: string }>(
        `INSERT INTO organization_members (org_id,user_id,role,status,invited_by,invited_at,joined_at,joined_method,last_active_at)
         VALUES ($1,$2,$3,'active',$4,NOW(),NOW(),$5,NOW())
         ON CONFLICT (org_id,user_id) DO UPDATE SET status='active',role=$3,joined_at=NOW(),deactivated_at=NULL,deactivated_by=NULL,deactivation_reason=NULL
         RETURNING id`, [orgId, userId, role, invitedBy, method]
      );
      return (await this.findMember(orgId, userId))!;
    });
  }

  async removeMember(orgId: string, userId: string, by: string, reason?: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET status='removed',deactivated_at=NOW(),deactivated_by=$1,deactivation_reason=$2
       WHERE org_id=$3 AND user_id=$4 AND status='active'`, [by, reason??null, orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async suspendMember(orgId: string, userId: string, by: string, reason?: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET status='suspended',deactivated_at=NOW(),deactivated_by=$1,deactivation_reason=$2
       WHERE org_id=$3 AND user_id=$4 AND status='active'`, [by, reason??null, orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async reactivateMember(orgId: string, userId: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET status='active',deactivated_at=NULL,deactivated_by=NULL,deactivation_reason=NULL
       WHERE org_id=$1 AND user_id=$2 AND status='suspended'`, [orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async updateMemberRole(orgId: string, userId: string, role: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET role=$1 WHERE org_id=$2 AND user_id=$3 AND status='active'`, [role, orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async countOwners(orgId: string): Promise<number> {
    const r = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM organization_members WHERE org_id=$1 AND role='owner' AND status='active'`, [orgId]
    );
    return parseInt(r.rows[0]?.c ?? '0', 10);
  }

  // ── Audit Logs ────────────────────────────────────
  async createAuditLog(entry: CreateAuditLogRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (org_id,actor_user_id,actor_email,actor_ip,actor_user_agent,actor_session_id,action,entity_type,entity_id,entity_name,request_id,http_method,endpoint,old_values,new_values,changed_fields,status,failure_reason,is_sensitive,metadata)
       VALUES ($1,$2,$3,$4::inet,$5,$6::uuid,$7,$8,$9::uuid,$10,$11::uuid,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [entry.orgId, entry.actorUserId, entry.actorEmail??null, entry.actorIp??null, entry.actorUserAgent??null, entry.actorSessionId??null,
       entry.action, entry.entityType, entry.entityId??null, entry.entityName??null, entry.requestId??null, entry.httpMethod??null,
       entry.endpoint??null, entry.oldValues?JSON.stringify(entry.oldValues):null, entry.newValues?JSON.stringify(entry.newValues):null,
       entry.changedFields??null, entry.status??'success', entry.failureReason??null, entry.isSensitive??false,
       entry.metadata?JSON.stringify(entry.metadata):'{}']
    );
  }

  async listAuditLogs(orgId: string, q: CursorPaginationQuery, filters?: { action?: string; entityType?: string; actorUserId?: string }): Promise<CursorPaginatedResponse<AuditLogRow>> {
    const params: unknown[] = [orgId];
    let where = `org_id=$1`;
    if (filters?.action) { params.push(filters.action); where += ` AND action=$${params.length}`; }
    if (filters?.entityType) { params.push(filters.entityType); where += ` AND entity_type=$${params.length}`; }
    if (filters?.actorUserId) { params.push(filters.actorUserId); where += ` AND actor_user_id=$${params.length}`; }
    if (q.cursor) { params.push(q.cursor); where += ` AND created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<AuditLogRow>(
      `SELECT id,org_id,actor_user_id,actor_email,action,entity_type,entity_id,entity_name,old_values,new_values,changed_fields,status,is_sensitive,metadata,created_at
       FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  // ── Invitations ────────────────────────────────
  async createInvitation(orgId: string, invitedBy: string, email: string, role: string, tokenHash: string, expiresAt: Date): Promise<OrgInvitationRow> {
    const r = await this.db.query<OrgInvitationRow>(
      `WITH ins AS (INSERT INTO organization_invitations (org_id,invited_by,email,role,token_hash,expires_at,status)
       VALUES ($1,$2,LOWER($3),$4,$5,$6,'pending')
       RETURNING id,org_id,invited_by,email,role,expires_at,status,accepted_at,accepted_by,declined_at,revoked_at,revoked_by,resent_count,last_resent_at,created_at)
       SELECT ins.id,ins.org_id,ins.invited_by,inv.email AS invited_by_email,inv.full_name AS invited_by_name,ins.email,ins.role,ins.expires_at,ins.status,ins.accepted_at,ins.accepted_by,ins.declined_at,ins.revoked_at,ins.revoked_by,ins.resent_count,ins.last_resent_at,ins.created_at
       FROM ins LEFT JOIN users inv ON inv.id=ins.invited_by`,
      [orgId, invitedBy, email, role, tokenHash, expiresAt]
    );
    if (!r.rows[0]) throw new NotFoundError("Invitation");
    return r.rows[0];
  }

  async findInvitationById(id: string): Promise<OrgInvitationRow | null> {
    const r = await this.db.query<OrgInvitationRow>(
      `SELECT oi.id,oi.org_id,oi.invited_by,inv.email AS invited_by_email,inv.full_name AS invited_by_name,oi.email,oi.role,oi.expires_at,oi.status,oi.accepted_at,oi.accepted_by,oi.declined_at,oi.revoked_at,oi.revoked_by,oi.resent_count,oi.last_resent_at,oi.created_at
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE oi.id=$1`, [id]
    );
    return r.rows[0] ?? null;
  }

  async findInvitationByTokenHash(hash: string): Promise<(OrgInvitationRow & { email_hash?: string }) | null> {
    const r = await this.db.query<OrgInvitationRow & { email_hash: string }>(
      `SELECT oi.id,oi.org_id,oi.invited_by,inv.email AS invited_by_email,inv.full_name AS invited_by_name,oi.email,oi.email_hash,oi.role,oi.expires_at,oi.status,oi.accepted_at,oi.accepted_by,oi.declined_at,oi.revoked_at,oi.revoked_by,oi.resent_count,oi.last_resent_at,oi.created_at
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE oi.token_hash=$1 AND oi.status='pending' AND oi.expires_at > NOW()`, [hash]
    );
    return r.rows[0] ?? null;
  }

  async listInvitations(orgId: string, q: CursorPaginationQuery, status?: string): Promise<CursorPaginatedResponse<OrgInvitationRow>> {
    const params: unknown[] = [orgId];
    let where = `oi.org_id=$1`;
    if (status) { params.push(status); where += ` AND oi.status=$${params.length}`; }
    if (q.cursor) { params.push(q.cursor); where += ` AND oi.created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<OrgInvitationRow>(
      `SELECT oi.id,oi.org_id,oi.invited_by,inv.email AS invited_by_email,inv.full_name AS invited_by_name,oi.email,oi.role,oi.expires_at,oi.status,oi.accepted_at,oi.accepted_by,oi.declined_at,oi.revoked_at,oi.revoked_by,oi.resent_count,oi.last_resent_at,oi.created_at
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE ${where} ORDER BY oi.created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  async acceptInvitation(tokenHash: string, userId: string): Promise<void> {
    const r = await this.db.query(`UPDATE organization_invitations SET status='accepted',accepted_at=NOW(),accepted_by=$1 WHERE token_hash=$2 AND status='pending' AND expires_at > NOW()`, [userId, tokenHash]);
    if (r.rowCount === 0) throw new NotFoundError("Invitation");
  }

  async declineInvitation(id: string): Promise<void> {
    const r = await this.db.query(`UPDATE organization_invitations SET status='declined',declined_at=NOW() WHERE id=$1 AND status='pending'`, [id]);
    if (r.rowCount === 0) throw new NotFoundError("Invitation");
  }

  async revokeInvitation(id: string, by: string): Promise<void> {
    const r = await this.db.query(`UPDATE organization_invitations SET status='revoked',revoked_at=NOW(),revoked_by=$1 WHERE id=$2 AND status='pending'`, [by, id]);
    if (r.rowCount === 0) throw new NotFoundError("Invitation");
  }

  async incrementResentCount(id: string): Promise<void> {
    await this.db.query(`UPDATE organization_invitations SET resent_count=resent_count+1,last_resent_at=NOW() WHERE id=$1`, [id]);
  }

  // ── Environments ──────────────────────────────
  async createEnvironment(orgId: string, name: string, desc: string | null, isProd: boolean, createdBy: string): Promise<OrgEnvironmentRow> {
    const slug = generateEnvSlug(name);
    const r = await this.db.query<OrgEnvironmentRow>(
      `INSERT INTO organization_environments (org_id,name,slug,description,is_production,created_by) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id,org_id,name,slug,description,is_production,created_by,created_at`, [orgId, name, slug, desc, isProd, createdBy]
    );
    return r.rows[0]!;
  }

  async updateEnvironment(orgId: string, envId: string, data: Record<string, unknown>): Promise<OrgEnvironmentRow> {
    const cols: string[] = []; const vals: unknown[] = [];
    const map: Record<string, string> = { name: 'name', description: 'description', isProduction: 'is_production' };
    for (const [k, v] of Object.entries(data)) { if (v !== undefined && map[k]) { cols.push(`${map[k]}=$${cols.length + 3}`); vals.push(v); } }
    if (cols.length === 0) throw new ConflictError("No fields to update");
    const r = await this.db.query<OrgEnvironmentRow>(
      `UPDATE organization_environments SET ${cols.join(',')} WHERE org_id=$1 AND id=$2
       RETURNING id,org_id,name,slug,description,is_production,created_by,created_at`, [orgId, envId, ...vals]
    );
    if (!r.rows[0]) throw new NotFoundError("Environment");
    return r.rows[0];
  }

  async listEnvironments(orgId: string): Promise<OrgEnvironmentRow[]> {
    const r = await this.db.query<OrgEnvironmentRow>(
      `SELECT id,org_id,name,slug,description,is_production,created_by,created_at FROM organization_environments WHERE org_id=$1 ORDER BY created_at ASC`, [orgId]
    );
    return r.rows;
  }

  // ── API Keys ──────────────────────────────────
  async createApiKey(orgId: string, name: string, keyPrefix: string, hashedKey: string, role: string, envId: string | null, expiresAt: Date | null, createdBy: string): Promise<OrgApiKeyRow> {
    const r = await this.db.query<OrgApiKeyRow>(
      `INSERT INTO organization_api_keys (org_id,name,key_prefix,hashed_key,role,environment_id,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,org_id,environment_id,name,key_prefix,role,last_used_at,expires_at,revoked_at,created_by,created_at`,
      [orgId, name, keyPrefix, hashedKey, role, envId, expiresAt, createdBy]
    );
    return r.rows[0]!;
  }

  async revokeApiKey(orgId: string, keyId: string): Promise<void> {
    const r = await this.db.query(`UPDATE organization_api_keys SET revoked_at=NOW() WHERE org_id=$1 AND id=$2 AND revoked_at IS NULL`, [orgId, keyId]);
    if (r.rowCount === 0) throw new NotFoundError("API Key");
  }

  async listApiKeys(orgId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<OrgApiKeyRow>> {
    const params: unknown[] = [orgId];
    let where = `org_id=$1 AND revoked_at IS NULL`;
    if (q.cursor) { params.push(q.cursor); where += ` AND created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<OrgApiKeyRow>(
      `SELECT id,org_id,environment_id,name,key_prefix,role,last_used_at,expires_at,revoked_at,created_by,created_at FROM organization_api_keys WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  // ── SSO Providers ─────────────────────────────
  async createSsoProvider(orgId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow> {
    const r = await this.db.query<OrgSsoProviderRow>(
      `INSERT INTO organization_sso_providers (org_id,provider_name,provider_type,entity_id,sso_url,x509_certificate,domain) VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at`,
      [orgId, data.providerName, data.providerType, data.entityId ?? null, data.ssoUrl ?? null, data.x509Certificate ?? null, data.domain ?? null]
    );
    return r.rows[0]!;
  }

  async updateSsoProvider(orgId: string, ssoId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow> {
    const cols: string[] = []; const vals: unknown[] = [];
    const map: Record<string, string> = { providerName: 'provider_name', entityId: 'entity_id', ssoUrl: 'sso_url', x509Certificate: 'x509_certificate', domain: 'domain', isActive: 'is_active' };
    for (const [k, v] of Object.entries(data)) { if (v !== undefined && map[k]) { cols.push(`${map[k]}=$${cols.length + 3}`); vals.push(v); } }
    if (cols.length === 0) throw new ConflictError("No fields to update");
    const r = await this.db.query<OrgSsoProviderRow>(
      `UPDATE organization_sso_providers SET ${cols.join(',')} WHERE org_id=$1 AND id=$2
       RETURNING id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at`, [orgId, ssoId, ...vals]
    );
    if (!r.rows[0]) throw new NotFoundError("SSO Provider");
    return r.rows[0];
  }

  async deleteSsoProvider(orgId: string, ssoId: string): Promise<void> {
    const r = await this.db.query(`DELETE FROM organization_sso_providers WHERE org_id=$1 AND id=$2`, [orgId, ssoId]);
    if (r.rowCount === 0) throw new NotFoundError("SSO Provider");
  }

  // ── SCIM Tokens ───────────────────────────────
  async createScimToken(orgId: string, tokenHash: string, expiresAt: Date | null, createdBy: string): Promise<OrgScimTokenRow> {
    const r = await this.db.query<OrgScimTokenRow>(
      `INSERT INTO organization_scim_tokens (org_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,$4)
       RETURNING id,org_id,last_used_at,expires_at,revoked_at,created_by,created_at`, [orgId, tokenHash, expiresAt, createdBy]
    );
    return r.rows[0]!;
  }

  async revokeScimToken(orgId: string, tokenId: string): Promise<void> {
    const r = await this.db.query(`UPDATE organization_scim_tokens SET revoked_at=NOW() WHERE org_id=$1 AND id=$2 AND revoked_at IS NULL`, [orgId, tokenId]);
    if (r.rowCount === 0) throw new NotFoundError("SCIM Token");
  }

  // ── Security Events ───────────────────────────
  async listSecurityEvents(orgId: string, q: CursorPaginationQuery, filters?: { severity?: string; eventType?: string }): Promise<CursorPaginatedResponse<SecurityEventRow>> {
    const params: unknown[] = [orgId];
    let where = `org_id=$1`;
    if (filters?.severity) { params.push(filters.severity); where += ` AND severity=$${params.length}`; }
    if (filters?.eventType) { params.push(filters.eventType); where += ` AND event_type=$${params.length}`; }
    if (q.cursor) { params.push(q.cursor); where += ` AND created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<SecurityEventRow>(
      `SELECT id,org_id,user_id,event_type,severity,ip_address::text AS ip_address,metadata,created_at
       FROM organization_security_events WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  // ── Quota Requests ────────────────────────────
  async createQuotaRequest(orgId: string, quotaType: string, currentLimit: number, requestedLimit: number, reason: string): Promise<QuotaRequestRow> {
    const r = await this.db.query<QuotaRequestRow>(
      `INSERT INTO quota_requests (org_id,quota_type,current_limit,requested_limit,reason) VALUES ($1,$2,$3,$4,$5)
       RETURNING id,org_id,quota_type,current_limit,requested_limit,reason,status,reviewed_by,reviewed_at,notes,metadata,created_at,updated_at`,
      [orgId, quotaType, currentLimit, requestedLimit, reason]
    );
    return r.rows[0]!;
  }

  async reviewQuotaRequest(orgId: string, requestId: string, status: string, reviewedBy: string, notes?: string): Promise<QuotaRequestRow> {
    const r = await this.db.query<QuotaRequestRow>(
      `UPDATE quota_requests SET status=$1,reviewed_by=$2,reviewed_at=NOW(),notes=$3 WHERE org_id=$4 AND id=$5 AND status='pending'
       RETURNING id,org_id,quota_type,current_limit,requested_limit,reason,status,reviewed_by,reviewed_at,notes,metadata,created_at,updated_at`,
      [status, reviewedBy, notes ?? null, orgId, requestId]
    );
    if (!r.rows[0]) throw new NotFoundError("Quota Request");
    return r.rows[0];
  }

  async listQuotaRequests(orgId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<QuotaRequestRow>> {
    const params: unknown[] = [orgId];
    let where = `org_id=$1`;
    if (q.cursor) { params.push(q.cursor); where += ` AND created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<QuotaRequestRow>(
      `SELECT id,org_id,quota_type,current_limit,requested_limit,reason,status,reviewed_by,reviewed_at,notes,metadata,created_at,updated_at
       FROM quota_requests WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  // ── User Organizations ───────────────────────
  async listUserOrganizations(userId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<UserOrgRow>> {
    const params: unknown[] = [userId];
    let where = `om.user_id=$1 AND om.status='active' AND o.deleted_at IS NULL`;
    if (q.search) { params.push(`%${q.search}%`); where += ` AND (o.name ILIKE $${params.length} OR o.slug ILIKE $${params.length})`; }
    if (q.cursor) { params.push(q.cursor); where += ` AND o.created_at < $${params.length}`; }
    params.push(q.limit + 1);
    const r = await this.db.query<UserOrgRow>(
      `SELECT o.id,o.name,o.slug,o.logo_url,o.status,om.role,o.created_at
       FROM organization_members om
       JOIN organizations o ON o.id=om.org_id
       WHERE ${where}
       ORDER BY o.created_at DESC LIMIT $${params.length}`, params
    );
    return cursorPage(r.rows, q.limit);
  }

  // ── Invitation by org + id (tenant-safe) ─────
  async findInvitationByOrgAndId(orgId: string, invitationId: string): Promise<OrgInvitationRow | null> {
    const r = await this.db.query<OrgInvitationRow>(
      `SELECT oi.id,oi.org_id,oi.invited_by,inv.email AS invited_by_email,inv.full_name AS invited_by_name,oi.email,oi.role,oi.expires_at,oi.status,oi.accepted_at,oi.accepted_by,oi.declined_at,oi.revoked_at,oi.revoked_by,oi.resent_count,oi.last_resent_at,oi.created_at
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by
       WHERE oi.org_id=$1 AND oi.id=$2`, [orgId, invitationId]
    );
    return r.rows[0] ?? null;
  }

  // ── Rotate API Key (revoke + create in tx) ───
  async rotateApiKey(orgId: string, keyId: string, newName: string, newPrefix: string, newHashedKey: string, newRole: string, envId: string | null, expiresAt: Date | null, createdBy: string): Promise<OrgApiKeyRow> {
    return this.withTransaction(async (client) => {
      const rev = await client.query(
        `UPDATE organization_api_keys SET revoked_at=NOW() WHERE org_id=$1 AND id=$2 AND revoked_at IS NULL RETURNING id`, [orgId, keyId]
      );
      if (rev.rowCount === 0) throw new NotFoundError("API Key");
      const r = await client.query<OrgApiKeyRow>(
        `INSERT INTO organization_api_keys (org_id,name,key_prefix,hashed_key,role,environment_id,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING id,org_id,environment_id,name,key_prefix,role,last_used_at,expires_at,revoked_at,created_by,created_at`,
        [orgId, newName, newPrefix, newHashedKey, newRole, envId, expiresAt, createdBy]
      );
      return r.rows[0]!;
    });
  }

  // ── Export Audit Logs (no cursor limit) ───────
  async exportAuditLogs(orgId: string, filters?: { action?: string; entityType?: string; actorUserId?: string; startDate?: string; endDate?: string }): Promise<AuditLogRow[]> {
    const params: unknown[] = [orgId];
    let where = `org_id=$1`;
    if (filters?.action) { params.push(filters.action); where += ` AND action=$${params.length}`; }
    if (filters?.entityType) { params.push(filters.entityType); where += ` AND entity_type=$${params.length}`; }
    if (filters?.actorUserId) { params.push(filters.actorUserId); where += ` AND actor_user_id=$${params.length}`; }
    if (filters?.startDate) { params.push(filters.startDate); where += ` AND created_at >= $${params.length}::timestamptz`; }
    if (filters?.endDate) { params.push(filters.endDate); where += ` AND created_at <= $${params.length}::timestamptz`; }
    params.push(10000); // hard cap
    const r = await this.db.query<AuditLogRow>(
      `SELECT id,org_id,actor_user_id,actor_email,action,entity_type,entity_id,entity_name,old_values,new_values,changed_fields,status,is_sensitive,metadata,created_at
       FROM audit_logs WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params
    );
    return r.rows;
  }

  // ── Slug availability check ──────────────────
  async isSlugAvailable(slug: string): Promise<boolean> {
    const r = await this.db.query<{ x: boolean }>(
      `SELECT EXISTS(SELECT 1 FROM organizations WHERE slug=$1 AND deleted_at IS NULL) AS x`, [slug]
    );
    return !r.rows[0]?.x;
  }

  // ── List SCIM Tokens ─────────────────────────
  async listScimTokens(orgId: string): Promise<OrgScimTokenRow[]> {
    const r = await this.db.query<OrgScimTokenRow>(
      `SELECT id,org_id,last_used_at,expires_at,revoked_at,created_by,created_at
       FROM organization_scim_tokens WHERE org_id=$1 AND revoked_at IS NULL ORDER BY created_at DESC`, [orgId]
    );
    return r.rows;
  }

  // ── List SSO Providers ───────────────────────
  async listSsoProviders(orgId: string): Promise<OrgSsoProviderRow[]> {
    const r = await this.db.query<OrgSsoProviderRow>(
      `SELECT id,org_id,provider_name,provider_type,entity_id,sso_url,domain,is_active,created_at
       FROM organization_sso_providers WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]
    );
    return r.rows;
  }
}
