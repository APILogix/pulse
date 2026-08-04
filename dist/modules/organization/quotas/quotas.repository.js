import { BaseRepository, cursorPage } from "../shared/base.repository.js";
import { NotFoundError } from "../shared/errors.js";
export class QuotasRepository extends BaseRepository {
    async getBillingEntitlements(orgId) {
        const r = await this.db.query(`SELECT
         s.id AS subscription_id,
         s.status AS subscription_status,
         p.id AS plan_id,
         p.key AS plan_key,
         p.tier AS plan_tier,
         COALESCE(
           jsonb_object_agg(
             e.feature_key,
             COALESCE(
               to_jsonb(e.boolean_value),
               to_jsonb(e.integer_value),
               to_jsonb(e.decimal_value),
               to_jsonb(e.string_value)
             )
           ) FILTER (WHERE e.feature_key IS NOT NULL),
           '{}'::jsonb
         ) AS feature_config,
         COALESCE(MAX(e.integer_value) FILTER (WHERE e.feature_key IN ('quota.monthly_events', 'monthly_events')), 0) AS event_limit_monthly,
         FALSE AS hard_cap
       FROM organization_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN v_effective_entitlements e ON e.organization_id = s.organization_id
       WHERE s.organization_id = $1
         AND s.status IN ('trialing','active','past_due')
         AND s.deleted_at IS NULL
         AND p.is_active = TRUE
         AND p.deleted_at IS NULL
       GROUP BY s.id, s.status, p.id, p.key, p.tier
       ORDER BY MAX(s.created_at) DESC
       LIMIT 1`, [orgId]);
        return r.rows[0] ?? null;
    }
    async getOrganizationUsageCounts(orgId) {
        const r = await this.db.query(`SELECT
         (SELECT COUNT(*)::text
          FROM organization_members
          WHERE org_id = $1 AND status = 'active') AS active_members,
         (SELECT COUNT(*)::text
          FROM organization_invitations
          WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW()) AS pending_invitations,
         (SELECT COUNT(*)::text
          FROM organization_sso_providers
          WHERE org_id = $1 AND is_active = TRUE) AS sso_providers,
         (SELECT COUNT(*)::text
          FROM organization_scim_tokens
          WHERE org_id = $1 AND revoked_at IS NULL) AS scim_tokens,
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
         SELECT *
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
    async createQuotaRequest(orgId, quotaType, currentLimit, requestedLimit, reason) {
        const r = await this.db.query(`INSERT INTO quota_requests (org_id,quota_type,current_limit,requested_limit,reason) VALUES ($1,$2,$3,$4,$5)
       RETURNING id,org_id,quota_type,current_limit,requested_limit,reason,status,reviewed_by,reviewed_at,notes,metadata,created_at,updated_at`, [orgId, quotaType, currentLimit, requestedLimit, reason]);
        return r.rows[0];
    }
    async reviewQuotaRequest(orgId, requestId, status, reviewedBy, notes) {
        const r = await this.db.query(`UPDATE quota_requests SET status=$1,reviewed_by=$2,reviewed_at=NOW(),notes=$3 WHERE org_id=$4 AND id=$5 AND status='pending'
       RETURNING id,org_id,quota_type,current_limit,requested_limit,reason,status,reviewed_by,reviewed_at,notes,metadata,created_at,updated_at`, [status, reviewedBy, notes ?? null, orgId, requestId]);
        if (!r.rows[0])
            throw new NotFoundError("Quota Request");
        return r.rows[0];
    }
    async listQuotaRequests(orgId, q) {
        const countParams = [orgId];
        let countWhere = `org_id=$1`;
        const countRes = await this.db.query(`SELECT COUNT(*)::text as count FROM quota_requests WHERE ${countWhere}`, countParams);
        const totalCount = Number(countRes.rows[0]?.count ?? 0);
        const params = [...countParams];
        let where = countWhere;
        if (q.cursor) {
            params.push(q.cursor);
            where += ` AND created_at < $${params.length}`;
        }
        params.push(q.limit + 1);
        const r = await this.db.query(`SELECT id,org_id,quota_type,current_limit,requested_limit,reason,status,reviewed_by,reviewed_at,notes,metadata,created_at,updated_at
       FROM quota_requests WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
        return cursorPage(r.rows, q.limit, totalCount);
    }
}
//# sourceMappingURL=quotas.repository.js.map