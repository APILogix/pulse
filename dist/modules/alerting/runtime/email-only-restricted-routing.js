import { pool } from '../../../config/database.js';
export class ProjectOwnerRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async findActiveVerifiedOwner(organizationId, projectId) {
        const result = await this.db.query(`SELECT member.user_id, LOWER(BTRIM(user_account.email)) AS email
         FROM project_members member
         JOIN organization_members organization_member
           ON organization_member.org_id = member.organization_id
          AND organization_member.user_id = member.user_id
          AND organization_member.status = 'active'
         JOIN users user_account ON user_account.id = member.user_id
          AND user_account.status = 'active'
          AND user_account.email_verified = TRUE
          AND NULLIF(BTRIM(user_account.email), '') IS NOT NULL
        WHERE member.organization_id = $1
          AND member.project_id = $2
          AND member.role = 'owner'
          AND member.status = 'active'
        ORDER BY member.updated_at DESC NULLS LAST, member.created_at ASC, member.user_id ASC
        LIMIT 1`, [organizationId, projectId]);
        const row = result.rows[0];
        return row ? { userId: row.user_id, email: row.email } : null;
    }
    async findActiveVerifiedFallbackRecipient(organizationId, _projectId) {
        const result = await this.db.query(`SELECT organization_member.user_id, LOWER(BTRIM(user_account.email)) AS email
         FROM organization_members organization_member
         JOIN users user_account ON user_account.id = organization_member.user_id
          AND user_account.status = 'active'
          AND user_account.email_verified = TRUE
          AND NULLIF(BTRIM(user_account.email), '') IS NOT NULL
        WHERE organization_member.org_id = $1
          AND organization_member.status = 'active'
          AND organization_member.role IN ('owner', 'admin')
        ORDER BY CASE organization_member.role WHEN 'owner' THEN 0 ELSE 1 END,
                 organization_member.updated_at DESC NULLS LAST,
                 organization_member.created_at ASC,
                 organization_member.user_id ASC
        LIMIT 1`, [organizationId]);
        const row = result.rows[0];
        return row ? { userId: row.user_id, email: row.email } : null;
    }
}
export class EmailOnlyRestrictedRouting {
    owners;
    constructor(owners = new ProjectOwnerRepository()) {
        this.owners = owners;
    }
    async resolve(organizationId, projectId) {
        const owner = await this.owners.findActiveVerifiedOwner(organizationId, projectId);
        if (owner) {
            return {
                reason: 'EMAIL_ONLY_RESTRICTED',
                target: {
                    channelKind: 'email',
                    channelId: null,
                    connectorId: null,
                    recipientUserId: owner.userId,
                    recipientRef: normalizeEmail(owner.email),
                    routeId: null,
                    deliveryMode: 'EMAIL_ONLY_RESTRICTED',
                    recipientType: 'PROJECT_OWNER',
                    provider: 'MANAGED_EMAIL',
                },
            };
        }
        // If project owner is inactive / unverified / absent, check for active verified organization fallback recipient
        if (this.owners.findActiveVerifiedFallbackRecipient) {
            const fallback = await this.owners.findActiveVerifiedFallbackRecipient(organizationId, projectId);
            if (fallback) {
                return {
                    reason: 'EMAIL_ONLY_RESTRICTED',
                    target: {
                        channelKind: 'email',
                        channelId: null,
                        connectorId: null,
                        recipientUserId: fallback.userId,
                        recipientRef: normalizeEmail(fallback.email),
                        routeId: null,
                        deliveryMode: 'EMAIL_ONLY_RESTRICTED',
                        recipientType: 'ORGANIZATION_FALLBACK',
                        provider: 'MANAGED_EMAIL',
                    },
                };
            }
        }
        return { target: null, reason: 'OWNER_EMAIL_UNAVAILABLE' };
    }
}
function normalizeEmail(email) {
    return email.trim().toLowerCase();
}
//# sourceMappingURL=email-only-restricted-routing.js.map