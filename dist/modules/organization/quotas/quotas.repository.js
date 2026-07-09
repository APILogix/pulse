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
         p.feature_config,
         p.event_limit_monthly,
         p.hard_cap
       FROM organization_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       WHERE s.org_id = $1
         AND s.status IN ('trialing','active','past_due')
         AND p.is_active = TRUE
       ORDER BY s.created_at DESC
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
          WHERE org_id = $1 AND revoked_at IS NULL) AS scim_tokens`, [orgId]);
        const row = r.rows[0];
        return {
            activeMembers: Number(row.active_members ?? 0),
            pendingInvitations: Number(row.pending_invitations ?? 0),
            ssoProviders: Number(row.sso_providers ?? 0),
            scimTokens: Number(row.scim_tokens ?? 0),
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
        const params = [orgId];
        let where = `org_id=$1`;
        if (q.cursor) {
            params.push(q.cursor);
            where += ` AND created_at < $${params.length}`;
        }
        params.push(q.limit + 1);
        const r = await this.db.query(`SELECT id,org_id,quota_type,current_limit,requested_limit,reason,status,reviewed_by,reviewed_at,notes,metadata,created_at,updated_at
       FROM quota_requests WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
        return cursorPage(r.rows, q.limit);
    }
}
//# sourceMappingURL=quotas.repository.js.map