import { BaseRepository, cursorPage } from "../shared/base.repository.js";
import { NotFoundError, ConflictError } from "../shared/errors.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { OrgInvitationRow } from "./invitations.schema.js";

export class InvitationsRepository extends BaseRepository {
  async createInvitation(orgId: string, invitedBy: string, email: string, role: string, tokenHash: string, expiresAt: Date): Promise<OrgInvitationRow> {
    const r = await this.db.query<OrgInvitationRow>(
      `WITH ins AS (INSERT INTO organization_invitations (org_id,invited_by,email,role,token_hash,expires_at,status) VALUES ($1,$2,$3,$4,$5,$6,'pending')
       ON CONFLICT (org_id, email) WHERE status = 'pending' DO NOTHING
       RETURNING id,org_id,invited_by,email,role,expires_at,status,accepted_at,accepted_by,declined_at,revoked_at,revoked_by,resent_count,last_resent_at,created_at,updated_at)
       SELECT ins.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM ins LEFT JOIN users inv ON inv.id=ins.invited_by`,
      [orgId, invitedBy, email, role, tokenHash, expiresAt]
    );
    if (!r.rows[0]) throw new ConflictError("A pending invitation already exists for this email");
    return r.rows[0];
  }

  async findInvitationById(id: string): Promise<OrgInvitationRow | null> {
    const r = await this.db.query<OrgInvitationRow>(
      `SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE oi.id=$1`, [id]
    );
    return r.rows[0] ?? null;
  }

  async findInvitationByTokenHash(hash: string): Promise<(OrgInvitationRow & { email_hash?: string }) | null> {
    const r = await this.db.query<OrgInvitationRow & { email_hash: string }>(
      `SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name, encode(digest(oi.email, 'sha256'), 'hex') as email_hash
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE oi.token_hash=$1`, [hash]
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
      `SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by WHERE ${where} ORDER BY oi.created_at DESC LIMIT $${params.length}`,
      params
    );
    return cursorPage(r.rows, q.limit);
  }

  async acceptInvitation(tokenHash: string, userId: string): Promise<void> {
    const r = await this.db.query(`UPDATE organization_invitations SET status='accepted',accepted_at=NOW(),accepted_by=$1 WHERE token_hash=$2 AND status='pending'`, [userId, tokenHash]);
    if (r.rowCount === 0) throw new NotFoundError("Invitation");
  }

  async acceptInvitationAndAddMember(tokenHash: string, userId: string, maxActiveMembers: number | null): Promise<void> {
    await this.withTransaction(async (client) => {
      const invite = await client.query<{ id: string; org_id: string; role: string; invited_by: string }>(
        `SELECT id, org_id, role, invited_by
         FROM organization_invitations
         WHERE token_hash = $1 AND status = 'pending' AND expires_at > NOW()
         FOR UPDATE`,
        [tokenHash]
      );
      const inv = invite.rows[0];
      if (!inv) throw new NotFoundError("Invitation");

      if (maxActiveMembers !== null && Number.isFinite(maxActiveMembers)) {
        const memberCount = await client.query<{ count: string }>(
          `SELECT COUNT(*)
           FROM organization_members
           WHERE org_id = $1 AND status = 'active'`,
          [inv.org_id]
        );
        if (Number(memberCount.rows[0]?.count ?? 0) >= maxActiveMembers) {
          throw new ConflictError("Member limit exceeded for current billing plan");
        }
      }

      await client.query(
        `UPDATE organization_invitations
         SET status = 'accepted',
             accepted_at = NOW(),
             accepted_by = $1
         WHERE id = $2`,
        [userId, inv.id]
      );

      await client.query(
        `INSERT INTO organization_members (
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
           deactivation_reason = NULL`,
        [inv.org_id, userId, inv.role, inv.invited_by]
      );
    });
  }

  async declineInvitation(id: string, _userId: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_invitations
       SET status='declined',declined_at=NOW()
       WHERE id=$1 AND status='pending'`, [id]
    );
    if (r.rowCount === 0) throw new NotFoundError("Invitation");
  }

  async revokeInvitation(id: string, by: string): Promise<void> {
    const r = await this.db.query(`UPDATE organization_invitations SET status='revoked',revoked_at=NOW(),revoked_by=$1 WHERE id=$2 AND status='pending'`, [by, id]);
    if (r.rowCount === 0) throw new NotFoundError("Invitation");
  }

  async incrementResentCount(id: string): Promise<void> {
    await this.db.query(`UPDATE organization_invitations SET resent_count=resent_count+1,last_resent_at=NOW() WHERE id=$1`, [id]);
  }

  async rotateInvitationToken(id: string, tokenHash: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_invitations SET token_hash=$1 WHERE id=$2 AND status='pending'`,
      [tokenHash, id]
    );
    if (r.rowCount === 0) throw new NotFoundError("Invitation");
  }

  async expireStalePendingInvitations(): Promise<number> {
    const r = await this.db.query(
      `UPDATE organization_invitations
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at <= NOW()`
    );
    return r.rowCount ?? 0;
  }

  async purgeTerminalInvitations(days: number): Promise<number> {
    const r = await this.db.query(
      `DELETE FROM organization_invitations
       WHERE status IN ('expired', 'revoked', 'declined')
         AND updated_at < NOW() - INTERVAL '${days} days'`
    );
    return r.rowCount ?? 0;
  }

  async findInvitationByOrgAndId(orgId: string, invitationId: string): Promise<OrgInvitationRow | null> {
    const r = await this.db.query<OrgInvitationRow>(
      `SELECT oi.*,inv.email AS invited_by_email,inv.full_name AS invited_by_name
       FROM organization_invitations oi LEFT JOIN users inv ON inv.id=oi.invited_by
       WHERE oi.org_id=$1 AND oi.id=$2`, [orgId, invitationId]
    );
    return r.rows[0] ?? null;
  }

  async findOrgNameAndSlug(orgId: string): Promise<{ name: string; slug: string } | null> {
    const r = await this.db.query<{ name: string; slug: string }>(
      `SELECT name, slug FROM organizations WHERE id = $1`,
      [orgId]
    );
    return r.rows[0] ?? null;
  }

  async findUserByEmail(email: string): Promise<{ id: string; email: string; full_name: string } | null> {
    const r = await this.db.query<{ id: string; email: string; full_name: string }>(
      `SELECT id, email, full_name
       FROM users
       WHERE lower(email) = lower($1) AND deleted_at IS NULL
       LIMIT 1`,
      [email]
    );
    return r.rows[0] ?? null;
  }
}
