import { BaseRepository, cursorPage } from "../shared/base.repository.js";
import { NotFoundError, ConflictError } from "../shared/errors.js";
export class InvitationsRepository extends BaseRepository {
    async createInvitation(orgId, invitedBy, email, role, tokenHash, expiresAt) {
        const r = await this.db.query(`WITH ins AS (INSERT INTO organization_invitations (org_id,invited_by,email,role,token_hash,expires_at,status) VALUES ($1,$2,$3,$4,$5,$6,'pending')
       ON CONFLICT (org_id, email) WHERE status = 'pending' DO NOTHING
       RETURNING id,org_id,invited_by,email,role,expires_at,status,accepted_at,accepted_by,declined_at,revoked_at,revoked_by,resent_count,last_resent_at,created_at,updated_at)
       SELECT ins.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM ins LEFT JOIN users inv ON inv.id=ins.invited_by`, [orgId, invitedBy, email, role, tokenHash, expiresAt]);
        if (!r.rows[0])
            throw new ConflictError("A pending invitation already exists for this email");
        return r.rows[0];
    }
    async findInvitationById(id) {
        const r = await this.db.query(`SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE oi.id=$1`, [id]);
        return r.rows[0] ?? null;
    }
    async findInvitationByTokenHash(hash) {
        const r = await this.db.query(`SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name, encode(digest(oi.email, 'sha256'), 'hex') as email_hash
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE oi.token_hash=$1`, [hash]);
        return r.rows[0] ?? null;
    }
    async listInvitations(orgId, q, status) {
        const params = [orgId];
        let where = `oi.org_id=$1`;
        if (status) {
            params.push(status);
            where += ` AND oi.status=$${params.length}`;
        }
        if (q.cursor) {
            params.push(q.cursor);
            where += ` AND oi.created_at < $${params.length}`;
        }
        params.push(q.limit + 1);
        const r = await this.db.query(`SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE ${where} ORDER BY oi.created_at DESC LIMIT $${params.length}`, params);
        return cursorPage(r.rows, q.limit);
    }
    async acceptInvitation(tokenHash, userId) {
        const r = await this.db.query(`UPDATE organization_invitations SET status='accepted',accepted_at=NOW(),accepted_by=$1 WHERE token_hash=$2 AND status='pending'`, [userId, tokenHash]);
        if (r.rowCount === 0)
            throw new NotFoundError("Invitation");
    }
    async acceptInvitationAndAddMember(tokenHash, userId, maxActiveMembers) {
        await this.withTransaction(async (client) => {
            const invite = await client.query(`SELECT id, org_id, role, invited_by
         FROM organization_invitations
         WHERE token_hash = $1 AND status = 'pending' AND expires_at > NOW()
         FOR UPDATE`, [tokenHash]);
            const inv = invite.rows[0];
            if (!inv)
                throw new NotFoundError("Invitation");
            if (maxActiveMembers !== null && Number.isFinite(maxActiveMembers)) {
                const memberCount = await client.query(`SELECT COUNT(*)
           FROM organization_members
           WHERE org_id = $1 AND status = 'active'`, [inv.org_id]);
                if (Number(memberCount.rows[0]?.count ?? 0) >= maxActiveMembers) {
                    throw new ConflictError("Member limit exceeded for current billing plan");
                }
            }
            await client.query(`UPDATE organization_invitations
         SET status = 'accepted',
             accepted_at = NOW(),
             accepted_by = $1
         WHERE id = $2`, [userId, inv.id]);
            await client.query(`INSERT INTO organization_members (
           org_id,
           user_id,
           role,
           status,
           invited_by,
           invited_at,
           joined_at,
           joined_method,
           last_active_at
         ) VALUES ($1,$2,$3,'active',$4,NOW(),NOW(),'invite',NOW())
         ON CONFLICT (org_id, user_id) DO UPDATE SET
           role = EXCLUDED.role,
           status = 'active',
           joined_at = NOW(),
           joined_method = 'invite',
           deactivated_at = NULL,
           deactivated_by = NULL,
           deactivation_reason = NULL`, [inv.org_id, userId, inv.role, inv.invited_by]);
        });
    }
    async declineInvitation(id, _userId) {
        const r = await this.db.query(`UPDATE organization_invitations
       SET status='declined',declined_at=NOW()
       WHERE id=$1 AND status='pending'`, [id]);
        if (r.rowCount === 0)
            throw new NotFoundError("Invitation");
    }
    async revokeInvitation(id, by) {
        const r = await this.db.query(`UPDATE organization_invitations SET status='revoked',revoked_at=NOW(),revoked_by=$1 WHERE id=$2 AND status='pending'`, [by, id]);
        if (r.rowCount === 0)
            throw new NotFoundError("Invitation");
    }
    async incrementResentCount(id) {
        await this.db.query(`UPDATE organization_invitations SET resent_count=resent_count+1,last_resent_at=NOW() WHERE id=$1`, [id]);
    }
    async rotateInvitationToken(id, tokenHash) {
        const r = await this.db.query(`UPDATE organization_invitations SET token_hash=$1 WHERE id=$2 AND status='pending'`, [tokenHash, id]);
        if (r.rowCount === 0)
            throw new NotFoundError("Invitation");
    }
    async expireStalePendingInvitations() {
        const r = await this.db.query(`UPDATE organization_invitations
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at <= NOW()`);
        return r.rowCount ?? 0;
    }
    async purgeTerminalInvitations(days) {
        const r = await this.db.query(`DELETE FROM organization_invitations
       WHERE status IN ('expired', 'revoked', 'declined')
         AND updated_at < NOW() - INTERVAL '${days} days'`);
        return r.rowCount ?? 0;
    }
    async findInvitationByOrgAndId(orgId, invitationId) {
        const r = await this.db.query(`SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by
       WHERE oi.org_id=$1 AND oi.id=$2`, [orgId, invitationId]);
        return r.rows[0] ?? null;
    }
    async findOrgNameAndSlug(orgId) {
        const r = await this.db.query(`SELECT name, slug FROM organizations WHERE id = $1`, [orgId]);
        return r.rows[0] ?? null;
    }
    async findUserByEmail(email) {
        const r = await this.db.query(`SELECT id, email, full_name
       FROM users
       WHERE lower(email) = lower($1) AND deleted_at IS NULL
       LIMIT 1`, [email]);
        return r.rows[0] ?? null;
    }
}
//# sourceMappingURL=invitations.repository.js.map