import { BaseRepository, cursorPage } from "../shared/base.repository.js";
import { NotFoundError } from "../shared/errors.js";
import type { CursorPaginationQuery, CursorPaginatedResponse } from "../shared/types.js";
import type { OrgMemberRow } from "./members.schema.js";

export class MembersRepository extends BaseRepository {
  async findActiveMember(orgId: string, userId: string): Promise<OrgMemberRow | null> {
    const r = await this.db.query<OrgMemberRow>(
      `SELECT om.*, u.email, u.full_name
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1 AND om.user_id=$2 AND om.status='active'`,
      [orgId, userId],
    );
    return r.rows[0] ?? null;
  }

  async findMember(orgId: string, userId: string): Promise<OrgMemberRow | null> {
    const r = await this.db.query<OrgMemberRow>(
      `SELECT om.*, u.email, u.full_name
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE om.org_id=$1 AND om.user_id=$2`,
      [orgId, userId],
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
    if (q.cursor) { params.push(q.cursor); where += ` AND om.created_at < $${params.length}`; }
    params.push(q.limit + 1);

    const r = await this.db.query<OrgMemberRow>(
      `SELECT om.*, u.email, u.full_name
       FROM organization_members om JOIN users u ON u.id=om.user_id
       WHERE ${where}
       ORDER BY om.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return cursorPage(r.rows, q.limit);
  }

  async addMember(orgId: string, userId: string, role: string, invitedBy: string, method: string): Promise<OrgMemberRow> {
    return this.withTransaction(async (client) => {
      await client.query(
        `INSERT INTO organization_members (org_id,user_id,role,status,invited_by,invited_at,joined_at,joined_method)
         VALUES ($1,$2,$3,'active',$4,NOW(),NOW(),$5)
         ON CONFLICT (org_id,user_id) DO UPDATE SET role=EXCLUDED.role,status='active',joined_at=NOW(),joined_method=EXCLUDED.joined_method`,
        [orgId, userId, role, invitedBy, method]
      );
      return (await this.findMember(orgId, userId))!;
    });
  }

  async removeMember(orgId: string, userId: string, by: string, reason?: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET status='removed',deactivated_at=NOW(),deactivated_by=$1,deactivation_reason=$2 WHERE org_id=$3 AND user_id=$4 AND status='active'`,
      [by, reason ?? null, orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async suspendMember(orgId: string, userId: string, by: string, reason?: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET status='suspended',deactivated_at=NOW(),deactivated_by=$1,deactivation_reason=$2 WHERE org_id=$3 AND user_id=$4 AND status='active'`,
      [by, reason ?? null, orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async reactivateMember(orgId: string, userId: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET status='active',deactivated_at=NULL,deactivated_by=NULL,deactivation_reason=NULL WHERE org_id=$1 AND user_id=$2 AND status IN ('suspended','removed')`,
      [orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async updateMemberRole(orgId: string, userId: string, role: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE organization_members SET role=$1 WHERE org_id=$2 AND user_id=$3 AND status='active'`, [role, orgId, userId]
    );
    if (r.rowCount === 0) throw new NotFoundError("Member");
  }

  async countActiveOwners(orgId: string): Promise<number> {
    const r = await this.db.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c FROM organization_members WHERE org_id=$1 AND role='owner' AND status='active'`, [orgId]
    );
    return Number(r.rows[0]?.c ?? 0);
  }
}
