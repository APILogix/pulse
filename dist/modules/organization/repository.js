import { BaseRepository, pgErr, cursorPage } from "./shared/base.repository.js";
import { pool } from "../../config/database.js";
import { generateSlug, generateEnvSlug } from "./shared/utils/index.js";
import { ConflictError, NotFoundError, } from "./types.js";
import { entitlementsService } from "../billing/entitlements/service.js";
export class OrganizationRepository extends BaseRepository {
    // ── Cleanup / Maintenance ─────────────────────
    // These are invoked by the scheduled organization cleanup cron (pg-boss,
    // Postgres-backed — no Redis). Each returns the number of affected rows so the
    // worker can log/observe the sweep. All are tenant-agnostic bulk sweeps; they
    // never expose data and are safe to run repeatedly (idempotent state moves /
    // bounded purges).
    /** Revoke SCIM tokens whose expires_at has passed but are not yet revoked. */
    async revokeExpiredScimTokens() {
        const r = await this.db.query(`UPDATE organization_scim_tokens
       SET revoked_at=NOW()
       WHERE revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at < NOW()`);
        return r.rowCount ?? 0;
    }
    /** Delete successfully-sent outbox rows older than `days` (delivery is done). */
    async purgeSentEmailOutbox(days) {
        const r = await this.db.query(`DELETE FROM organization_email_outbox
       WHERE status='sent' AND sent_at IS NOT NULL
         AND sent_at < NOW() - ($1 || ' days')::interval`, [String(days)]);
        return r.rowCount ?? 0;
    }
    /** Delete permanently-failed outbox rows older than `days` (retries exhausted). */
    async purgeFailedEmailOutbox(days) {
        const r = await this.db.query(`DELETE FROM organization_email_outbox
       WHERE status='failed'
         AND created_at < NOW() - ($1 || ' days')::interval`, [String(days)]);
        return r.rowCount ?? 0;
    }
    /**
     * organization_settings.audit_log_retention_days defines its own window;
     * non-sensitive logs older than that window are deleted. Sensitive logs
     * (is_sensitive = TRUE) are retained regardless — compliance/forensics keep
     * those even when normal operational logs roll off.
     */
    async purgeExpiredAuditLogs(batchSize = 5000) {
        let totalDeleted = 0;
        while (true) {
            const r = await this.db.query(`DELETE FROM organization_audit_logs
         WHERE id IN (
           SELECT a.id
           FROM organization_audit_logs a
           JOIN organization_settings s ON a.org_id = s.org_id
           WHERE a.is_sensitive = FALSE
             AND a.created_at < NOW() - (s.audit_log_retention_days || ' days')::interval
           LIMIT $1
         )`, [batchSize]);
            const count = r.rowCount ?? 0;
            totalDeleted += count;
            if (count < batchSize)
                break;
        }
        return totalDeleted;
    }
    /**
     * Retrieves the multi-organization context for a given user.
     * This is called during the login flow to append context to the response.
     */
    async getUserContextForLogin(userId) {
        return this.withTransaction(async (client) => {
            const orgsResult = await client.query(`SELECT o.id, o.slug, o.name, om.role
         FROM organizations o
         JOIN organization_members om ON o.id = om.org_id
         WHERE om.user_id = $1
           AND om.status = 'active'
           AND o.status = 'active'
           AND o.deleted_at IS NULL
         ORDER BY o.created_at ASC`, [userId]);
            const prefResult = await client.query(`SELECT default_org_id FROM user_preferences WHERE user_id = $1`, [userId]);
            const orgs = orgsResult.rows;
            let default_org_slug = null;
            if (orgs.length > 0) {
                const prefOrgId = prefResult.rows[0]?.default_org_id;
                const preferredOrg = orgs.find(o => o.id === prefOrgId);
                if (preferredOrg) {
                    default_org_slug = preferredOrg.slug;
                }
                else {
                    default_org_slug = orgs[0].slug;
                }
            }
            return {
                default_org_slug,
                organizations: orgs,
            };
        });
    }
    // ── Backward Compatibility for other modules ──
    async getBillingEntitlements(orgId) {
        const sub = await entitlementsService.getSubscriptionState(orgId);
        if (!sub)
            return null;
        const allEntitlements = await entitlementsService.getEffectiveEntitlements(orgId);
        const featureConfig = {};
        for (const [k, v] of Object.entries(allEntitlements)) {
            featureConfig[k] = v.booleanValue ?? v.integerValue ?? v.decimalValue ?? v.stringValue ?? null;
        }
        const eventLimit = await entitlementsService.getEffectiveIntegerFeature(orgId, 'quota.monthly_events');
        return {
            subscription_id: sub.subscriptionId,
            subscription_status: sub.status,
            plan_id: sub.planId,
            plan_key: sub.planKey,
            plan_tier: sub.planTier,
            feature_config: featureConfig,
            event_limit_monthly: eventLimit,
            hard_cap: false,
        };
    }
    async getOrganizationUsageCounts(orgId) {
        const r = await this.db.query(`SELECT
         (SELECT COUNT(*)::text FROM organization_members WHERE org_id = $1 AND status = 'active') AS active_members,
         (SELECT COUNT(*)::text FROM organization_invitations WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW()) AS pending_invitations,
         (SELECT COUNT(*)::text FROM organization_sso_providers WHERE org_id = $1 AND is_active = TRUE) AS sso_providers,
         (SELECT COUNT(*)::text FROM organization_scim_tokens WHERE org_id = $1 AND revoked_at IS NULL) AS scim_tokens,
         COALESCE(u.events_used, 0)::text AS events_used,
         COALESCE(u.event_limit, 0)::text AS event_limit,
         GREATEST(COALESCE(u.event_limit, 0) - COALESCE(u.events_used, 0), 0)::text AS remaining_events,
         COALESCE(u.ai_credits_used, 0)::text AS ai_credits_used,
         COALESCE(u.ai_credit_limit, 0)::text AS ai_credit_limit,
         GREATEST(COALESCE(u.ai_credit_limit, 0) - COALESCE(u.ai_credits_used, 0), 0)::text AS remaining_ai_credits,
         COALESCE(u.projects_used, 0)::text AS projects_used,
         COALESCE(u.api_keys_used, 0)::text AS api_keys_used,
         COALESCE(u.connectors_used, 0)::text AS connectors_used,
         COALESCE(u.alert_rules_used, 0)::text AS alert_rules_used,
         COALESCE(u.dashboards_used, 0)::text AS dashboards_used
       FROM (SELECT $1::uuid AS organization_id) org
       LEFT JOIN LATERAL (
         SELECT
           events_used,
           event_limit,
           ai_credits_used,
           ai_credit_limit,
           projects_used,
           api_keys_used,
           connectors_used,
           alert_rules_used,
           dashboards_used
         FROM organization_usage_current_period
         WHERE organization_id = org.organization_id
         ORDER BY period_end DESC
         LIMIT 1
       ) u ON TRUE`, [orgId]);
        const row = r.rows[0];
        return {
            activeMembers: Number(row.active_members ?? 0),
            pendingInvitations: Number(row.pending_invitations ?? 0),
            ssoProviders: Number(row.sso_providers ?? 0),
            scimTokens: Number(row.scim_tokens ?? 0),
            eventsUsed: Number(row.events_used ?? 0),
            eventLimit: Number(row.event_limit ?? 0),
            remainingEvents: Number(row.remaining_events ?? 0),
            aiCreditsUsed: Number(row.ai_credits_used ?? 0),
            aiCreditLimit: Number(row.ai_credit_limit ?? 0),
            remainingAiCredits: Number(row.remaining_ai_credits ?? 0),
            projectsUsed: Number(row.projects_used ?? 0),
            apiKeysUsed: Number(row.api_keys_used ?? 0),
            connectorsUsed: Number(row.connectors_used ?? 0),
            alertRulesUsed: Number(row.alert_rules_used ?? 0),
            dashboardsUsed: Number(row.dashboards_used ?? 0),
        };
    }
    /**
     * Adjust the fast-path `organization_usage_current_period.api_keys_used`
     * counter so org-level dashboards/quota checks reflect API key creation and
     * deletion immediately. Non-fatal: callers treat a missing usage row (org
     * has no active subscription period yet) as a no-op rather than an error,
     * since the authoritative limit enforcement is the live COUNT(*) in
     * `ProjectsRepository.getProjectModuleUsageCounts`.
     */
    async adjustApiKeyUsageCounter(orgId, delta) {
        await this.db.query(`UPDATE organization_usage_current_period
          SET api_keys_used = GREATEST(api_keys_used + $2, 0)
        WHERE organization_id = $1`, [orgId, delta]);
    }
    // ── Backward Compatibility for Modules ────────────────────────
    async findActiveMember(orgId, userId) {
        const r = await this.db.query(`SELECT om.id,om.org_id,om.user_id,om.role,om.status,u.email,u.full_name,om.invited_by,om.invited_at,om.joined_at,om.joined_method,om.last_active_at,om.deactivated_at,om.deactivated_by,om.deactivation_reason,om.created_at,om.updated_at
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1 AND om.user_id=$2 AND om.status='active'`, [orgId, userId]);
        return r.rows[0] ?? null;
    }
    async findUserByEmail(email) {
        // Normalize at app boundary — lets Postgres use a plain B-Tree index scan
        // instead of the non-sargable LOWER() that forces sequential scans at scale.
        const normalized = email.trim().toLowerCase();
        const r = await this.db.query(`SELECT id, email, full_name
       FROM users
       WHERE email = $1 AND deleted_at IS NULL
       LIMIT 1`, [normalized]);
        return r.rows[0] ?? null;
    }
    async expireStalePendingInvitations() {
        const r = await this.db.query(`UPDATE organization_invitations
       SET status='expired'
       WHERE status='pending' AND expires_at < NOW()`);
        return r.rowCount ?? 0;
    }
    async purgeTerminalInvitations(days) {
        const r = await this.db.query(`DELETE FROM organization_invitations
       WHERE status IN ('expired','revoked','declined')
         AND COALESCE(revoked_at, declined_at, accepted_at, expires_at, created_at) < NOW() - make_interval(days => $1)`, [days]);
        return r.rowCount ?? 0;
    }
}
//# sourceMappingURL=repository.js.map