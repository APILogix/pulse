import { pool } from "../../../config/database.js";
import { ProjectMemberRole, } from "../core/project.types.js";
import { ProjectError } from "../shared/utils.js";
const MEMBER_COLUMNS = `
  m.id, m.project_id, m.user_id, m.organization_id, m.role,
  m.invited_by, m.invited_at, m.joined_at, m.status, m.created_by,
  m.created_at, m.updated_at
`;
export class MemberRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async withTransaction(callback) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const result = await callback(client);
            await client.query("COMMIT");
            return result;
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async findOrganizationMembership(orgId, userId, client) {
        const result = await (client ?? this.db).query(`SELECT org_id, user_id, role, (status = 'active') AS is_active
         FROM organization_members
        WHERE org_id = $1 AND user_id = $2
        LIMIT 1`, [orgId, userId]);
        const row = result.rows[0];
        return row
            ? { orgId: row.org_id, userId: row.user_id, role: row.role, isActive: row.is_active }
            : null;
    }
    async isOrganizationMember(orgId, userId, client) {
        const membership = await this.findOrganizationMembership(orgId, userId, client);
        return membership?.isActive === true;
    }
    async listProjectMembers(projectId, query, client) {
        const db = client ?? this.db;
        const params = [projectId];
        const where = ["m.project_id = $1"];
        if (query.status) {
            params.push(query.status);
            where.push(`m.status = $${params.length}`);
        }
        else {
            where.push("m.status <> 'removed'");
        }
        if (query.role) {
            params.push(query.role);
            where.push(`m.role = $${params.length}`);
        }
        if (query.search) {
            params.push(`%${query.search}%`);
            where.push(`(u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
        }
        const count = await db.query(`SELECT COUNT(*)::text AS count
         FROM project_members m LEFT JOIN users u ON u.id = m.user_id
        WHERE ${where.join(" AND ")}`, params);
        const sortColumns = { created_at: "m.created_at", updated_at: "m.updated_at", role: "m.role" };
        const sort = sortColumns[query.sortBy];
        const order = query.sortOrder === "asc" ? "ASC" : "DESC";
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        params.push(query.limit, offset);
        const rows = await db.query(`SELECT ${MEMBER_COLUMNS}, u.email, u.full_name
         FROM project_members m LEFT JOIN users u ON u.id = m.user_id
        WHERE ${where.join(" AND ")}
        ORDER BY ${sort} ${order}
        LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return {
            members: rows.rows.map((row) => this.mapMember(row)),
            total: Number.parseInt(count.rows[0]?.count ?? "0", 10),
        };
    }
    async findProjectMemberByUserId(projectId, userId, client) {
        const result = await (client ?? this.db).query(`SELECT ${MEMBER_COLUMNS}, u.email, u.full_name
         FROM project_members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1 AND m.user_id = $2 LIMIT 1`, [projectId, userId]);
        return result.rows[0] ? this.mapMember(result.rows[0]) : null;
    }
    async findProjectMemberById(memberId, client) {
        const result = await (client ?? this.db).query(`SELECT ${MEMBER_COLUMNS}, u.email, u.full_name
         FROM project_members m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.id = $1 LIMIT 1`, [memberId]);
        return result.rows[0] ? this.mapMember(result.rows[0]) : null;
    }
    async addProjectMember(projectId, organizationId, userId, role, addedByUserId, client) {
        try {
            const result = await (client ?? this.db).query(`INSERT INTO project_members AS m(
           project_id,user_id,organization_id,role,invited_by,invited_at,joined_at,status,created_by
         ) VALUES($1,$2,$3,$4,$5,NOW(),NOW(),'active',$5)
         RETURNING ${MEMBER_COLUMNS}`, [projectId, userId, organizationId, role, addedByUserId]);
            return this.mapMember(result.rows[0]);
        }
        catch (error) {
            if (error.code === "23505") {
                throw new ProjectError("MEMBER_EXISTS", "User is already a member of this project", 409);
            }
            throw error;
        }
    }
    async restoreProjectMember(memberId, role, addedByUserId, client) {
        const result = await (client ?? this.db).query(`UPDATE project_members AS m
          SET role=$2,status='active',invited_by=$3,invited_at=NOW(),joined_at=NOW(),updated_at=NOW()
        WHERE id=$1 AND status='removed'
        RETURNING ${MEMBER_COLUMNS}`, [memberId, role, addedByUserId]);
        if (!result.rows[0])
            throw new ProjectError("MEMBER_NOT_FOUND", "Removed member not found", 404);
        return this.mapMember(result.rows[0]);
    }
    async ensureProjectOwner(projectId, organizationId, userId, client) {
        const result = await client.query(`INSERT INTO project_members AS m(
         project_id,user_id,organization_id,role,invited_by,invited_at,joined_at,status,created_by
       ) VALUES($1,$2,$3,'owner',$2,NOW(),NOW(),'active',$2)
       ON CONFLICT(project_id,user_id) DO UPDATE SET
         organization_id=EXCLUDED.organization_id, role='owner', status='active',
         invited_by=EXCLUDED.invited_by, invited_at=NOW(), joined_at=NOW(), updated_at=NOW()
       RETURNING ${MEMBER_COLUMNS}`, [projectId, userId, organizationId]);
        return this.mapMember(result.rows[0]);
    }
    async updateProjectMemberRole(memberId, role, client) {
        const result = await (client ?? this.db).query(`UPDATE project_members AS m SET role=$2,updated_at=NOW()
        WHERE id=$1 AND status='active'
        RETURNING ${MEMBER_COLUMNS}`, [memberId, role]);
        if (!result.rows[0])
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found or removed", 404);
        return this.mapMember(result.rows[0]);
    }
    async removeProjectMember(memberId, _removedByUserId, client) {
        const result = await (client ?? this.db).query(`UPDATE project_members AS m SET status='removed',updated_at=NOW()
        WHERE id=$1 AND status='active'
        RETURNING ${MEMBER_COLUMNS}`, [memberId]);
        if (!result.rows[0])
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found or already removed", 404);
        return this.mapMember(result.rows[0]);
    }
    async transferOwnership(projectId, fromUserId, toUserId, actorUserId, client) {
        const run = async (db) => {
            // Lock project membership rows to prevent race conditions during ownership transfer
            await db.query(`SELECT id FROM project_members WHERE project_id = $1 FOR UPDATE`, [projectId]);
            const from = await this.findProjectMemberByUserId(projectId, fromUserId, db);
            if (!from || from.role !== ProjectMemberRole.OWNER || from.status !== "active") {
                throw new ProjectError("MEMBER_NOT_FOUND", "Current owner membership not found", 404);
            }
            await db.query(`UPDATE project_members SET role='admin',updated_at=NOW() WHERE id=$1`, [from.id]);
            const target = await this.findProjectMemberByUserId(projectId, toUserId, db);
            let toMember;
            try {
                if (target?.status === "active") {
                    toMember = await this.updateProjectMemberRole(target.id, ProjectMemberRole.OWNER, db);
                }
                else if (target?.status === "removed") {
                    toMember = await this.restoreProjectMember(target.id, ProjectMemberRole.OWNER, actorUserId, db);
                }
                else {
                    toMember = await this.addProjectMember(projectId, from.organizationId, toUserId, ProjectMemberRole.OWNER, actorUserId, db);
                }
            }
            catch (err) {
                if (err.code === "23505") {
                    throw new ProjectError("CONCURRENT_OWNER_CONFLICT", "A concurrent owner change occurred for this project", 409);
                }
                throw err;
            }
            const fromMember = await this.findProjectMemberById(from.id, db);
            if (!fromMember)
                throw new ProjectError("INTERNAL_ERROR", "Owner transfer failed", 500);
            return { fromMember, toMember };
        };
        return client ? run(client) : this.withTransaction(run);
    }
    mapMember(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            userId: row.user_id,
            organizationId: row.organization_id,
            role: row.role,
            status: row.status,
            invitedByUserId: row.invited_by,
            invitedAt: row.invited_at,
            joinedAt: row.joined_at,
            createdByUserId: row.created_by,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            user: row.email
                ? { id: row.user_id, email: row.email, fullName: row.full_name ?? "" }
                : undefined,
        };
    }
}
//# sourceMappingURL=member.repository.js.map