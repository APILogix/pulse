import { BaseRepository, pgErr, cursorPage } from "./shared/base.repository.js";
import { pool } from "../../config/database.js";
import { generateSlug, generateEnvSlug } from "./shared/utils/index.js";
import {
  ConflictError, NotFoundError,
  type OrganizationRow, type OrgSettingsRow, type OrgMemberRow,
  type OrgInvitationRow, type AuditLogRow,
  type OrgSsoProviderRow, type OrgScimTokenRow,
  type SecurityEventRow, type QuotaRequestRow, type UserOrgRow,
  type CreateAuditLogRecord, type CursorPaginationQuery,
  type CursorPaginatedResponse, type InvitationStatus,
  type AlertThresholdRow,
} from "./types.js";



export interface OrganizationProvisioningResult {
  organization: OrganizationRow;
  subscriptionId: string;
  planId: string;
}

import type { BillingEntitlementsRow, OrganizationUsageCounts } from "./quotas/quotas.schema.js";
export type { BillingEntitlementsRow, OrganizationUsageCounts };

export class OrganizationRepository extends BaseRepository {










  // ── Cleanup / Maintenance ─────────────────────
  // These are invoked by the scheduled organization cleanup cron (pg-boss,
  // Postgres-backed — no Redis). Each returns the number of affected rows so the
  // worker can log/observe the sweep. All are tenant-agnostic bulk sweeps; they
  // never expose data and are safe to run repeatedly (idempotent state moves /
  // bounded purges).





  /** Revoke SCIM tokens whose expires_at has passed but are not yet revoked. */
  async revokeExpiredScimTokens(): Promise<number> {
    const r = await this.db.query(
      `UPDATE organization_scim_tokens
       SET revoked_at=NOW()
       WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < NOW()`
    );
    return r.rowCount ?? 0;
  }

  /** Delete successfully-sent outbox rows older than `days` (delivery is done). */
  async purgeSentEmailOutbox(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM organization_email_outbox
       WHERE status='sent' AND sent_at IS NOT NULL
         AND sent_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    return r.rowCount ?? 0;
  }

  /** Delete permanently-failed outbox rows older than `days` (retries exhausted). */
  async purgeFailedEmailOutbox(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM organization_email_outbox
       WHERE status='failed'
         AND created_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    return r.rowCount ?? 0;
  }

  /**
   * organization_settings.audit_log_retention_days defines its own window;
   * non-sensitive logs older than that window are deleted. Sensitive logs
   * (is_sensitive = TRUE) are retained regardless — compliance/forensics keep
   * those even when normal operational logs roll off.
   */
  async purgeExpiredAuditLogs(): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM organization_audit_logs a
       USING organization_settings s
       WHERE a.org_id = s.org_id
         AND a.is_sensitive = FALSE
         AND a.created_at < NOW() - (s.audit_log_retention_days || ' days')::interval`
    );
    return r.rowCount ?? 0;
  }

  /**
   * Retrieves the multi-organization context for a given user.
   * This is called during the login flow to append context to the response.
   */
  async getUserContextForLogin(userId: string): Promise<{
    default_org_slug: string | null;
    organizations: Array<{ id: string; slug: string; name: string; role: string }>;
  }> {
    return this.withTransaction(async (client) => {
      const orgsResult = await client.query<{
        id: string;
        slug: string;
        name: string;
        role: string;
      }>(
        `SELECT o.id, o.slug, o.name, om.role
         FROM organizations o
         JOIN organization_members om ON o.id = om.org_id
         WHERE om.user_id = $1
           AND om.status = 'active'
           AND o.status = 'active'
           AND o.deleted_at IS NULL
         ORDER BY o.created_at ASC`,
        [userId]
      );

      const prefResult = await client.query<{ default_org_id: string }>(
        `SELECT default_org_id FROM user_preferences WHERE user_id = $1`,
        [userId]
      );

      const orgs = orgsResult.rows;
      let default_org_slug: string | null = null;

      if (orgs.length > 0) {
        const prefOrgId = prefResult.rows[0]?.default_org_id;
        const preferredOrg = orgs.find(o => o.id === prefOrgId);
        
        if (preferredOrg) {
          default_org_slug = preferredOrg.slug;
        } else {
          default_org_slug = orgs[0]!.slug;
        }
      }

      return {
        default_org_slug,
        organizations: orgs,
      };
    });
  }

  // ── Backward Compatibility for other modules ──
  async getBillingEntitlements(orgId: string): Promise<BillingEntitlementsRow | null> {
    const r = await this.db.query<BillingEntitlementsRow>(
      `SELECT s.id AS subscription_id, s.status AS subscription_status, p.id AS plan_id, p.key AS plan_key, p.tier AS plan_tier, p.feature_config, p.event_limit_monthly, p.hard_cap FROM organization_subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.org_id = $1 AND s.status IN ('trialing','active','past_due') AND p.is_active = TRUE ORDER BY s.created_at DESC LIMIT 1`,
      [orgId],
    );
    return r.rows[0] ?? null;
  }

  async getOrganizationUsageCounts(orgId: string): Promise<OrganizationUsageCounts> {
    const r = await this.db.query<any>(
      `SELECT (SELECT COUNT(*)::text FROM organization_members WHERE org_id = $1 AND status = 'active') AS active_members, (SELECT COUNT(*)::text FROM organization_invitations WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW()) AS pending_invitations, (SELECT COUNT(*)::text FROM organization_sso_providers WHERE org_id = $1 AND is_active = TRUE) AS sso_providers, (SELECT COUNT(*)::text FROM organization_scim_tokens WHERE org_id = $1 AND revoked_at IS NULL) AS scim_tokens`,
      [orgId],
    );
    const row = r.rows[0]!;
    return { activeMembers: Number(row.active_members ?? 0), pendingInvitations: Number(row.pending_invitations ?? 0), ssoProviders: Number(row.sso_providers ?? 0), scimTokens: Number(row.scim_tokens ?? 0) };
  }

  async createAuditLog(entry: import("./audit-logs/audit-logs.schema.js").CreateAuditLogRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO organization_audit_logs (org_id,actor_user_id,actor_email,actor_ip,actor_user_agent,actor_session_id,action,entity_type,entity_id,entity_name,request_id,http_method,endpoint,old_values,new_values,changed_fields,status,failure_reason,is_sensitive,metadata) VALUES ($1,$2,$3,$4::inet,$5,$6::uuid,$7,$8,$9::uuid,$10,$11::uuid,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [entry.orgId, entry.actorUserId, entry.actorEmail??null, entry.actorIp??null, entry.actorUserAgent??null, entry.actorSessionId??null, entry.action, entry.entityType, entry.entityId??null, entry.entityName??null, entry.requestId??null, entry.httpMethod??null, entry.endpoint??null, entry.oldValues?JSON.stringify(entry.oldValues):null, entry.newValues?JSON.stringify(entry.newValues):null, entry.changedFields??null, entry.status??'success', entry.failureReason??null, entry.isSensitive??false, entry.metadata?JSON.stringify(entry.metadata):'{}']
    );
  }

  // ── Backward Compatibility for Modules ────────────────────────
  async findActiveMember(orgId: string, userId: string): Promise<OrgMemberRow | null> {
    const r = await this.db.query<OrgMemberRow>(
      `SELECT om.id,om.org_id,om.user_id,om.role,om.status,u.email,u.full_name,om.invited_by,om.invited_at,om.joined_at,om.joined_method,om.last_active_at,om.deactivated_at,om.deactivated_by,om.deactivation_reason,om.created_at,om.updated_at
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1 AND om.user_id=$2 AND om.status='active'`, [orgId, userId]
    );
    return r.rows[0] ?? null;
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string; full_name: string } | null> {
    const r = await this.db.query<{ id: string; email: string; full_name: string }>(
      `SELECT id, email, full_name
       FROM users
       WHERE lower(email) = lower($1) AND deleted_at IS NULL
       LIMIT 1`,
      [email],
    );
    return r.rows[0] ?? null;
  }

  async expireStalePendingInvitations(): Promise<number> {
    const r = await this.db.query(
      `UPDATE organization_invitations
       SET status='expired'
       WHERE status='pending' AND expires_at < NOW()`
    );
    return r.rowCount ?? 0;
  }

  async purgeTerminalInvitations(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM organization_invitations
       WHERE status IN ('expired','revoked','declined')
         AND created_at < NOW() - ($1 || ' days')::interval`,
      [String(days)]
    );
    return r.rowCount ?? 0;
  }
}
