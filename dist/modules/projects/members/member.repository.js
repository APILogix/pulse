/**
 * Project members, invitations, and custom roles repository.
 *
 * Flow:
 * 1. Accept service-level identifiers and already-validated options.
 * 2. Enforce tenant isolation by scoping every query to project_id and/or
 *    organization_id.
 * 3. Use soft-delete patterns (status = 'removed', removed_at/removed_by) for
 *    membership removal; invitations move through a finite state machine.
 * 4. Translate expected DB conflicts/misses into ProjectError with stable
 *    codes.
 */
import { createHash, randomBytes } from "crypto";
import { pool } from "../../../config/database.js";
import { ProjectMemberRole, } from "../core/project.types.js";
import { ProjectError } from "../shared/utils.js";
const MEMBER_COLUMNS = `
  m.id, m.project_id, m.user_id, m.organization_id, m.role, m.role_id, m.status,
  m.added_by_user_id, m.added_at, m.removed_by_user_id, m.removed_at,
  m.created_at, m.updated_at
`;
const INVITATION_COLUMNS = `
  id, project_id, organization_id, email, invited_by_user_id, invited_user_id,
  role, status, token_hash, expires_at, accepted_at, declined_at, cancelled_at,
  created_at, updated_at
`;
const ROLE_COLUMNS = `
  id, project_id, organization_id, name, slug, description, is_system, is_default,
  permissions, created_at, updated_at
`;
export function hashInvitationToken(token) {
    return createHash("sha256").update(token).digest("hex");
}
export function createInvitationToken() {
    return randomBytes(32).toString("hex");
}
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
    // ── Organization membership ───────────────────────────────────────────────
    async findOrganizationMembership(orgId, userId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT org_id, user_id, role, (status = 'active') AS is_active
         FROM organization_members
        WHERE org_id = $1 AND user_id = $2
        LIMIT 1`, [orgId, userId]);
        const row = result.rows[0];
        if (!row)
            return null;
        return {
            orgId: row.org_id,
            userId: row.user_id,
            role: row.role,
            isActive: row.is_active,
        };
    }
    async isOrganizationMember(orgId, userId, client) {
        const membership = await this.findOrganizationMembership(orgId, userId, client);
        return membership !== null && membership.isActive;
    }
    async findOrganizationMembershipByEmail(orgId, email, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT u.id AS user_id, u.email
         FROM users u
         JOIN organization_members om ON om.user_id = u.id
        WHERE om.org_id = $1
          AND om.status = 'active'
          AND LOWER(u.email) = LOWER($2)
        LIMIT 1`, [orgId, email]);
        const row = result.rows[0] ?? null;
        return row ? { userId: row.user_id, email: row.email } : null;
    }
    async findInvitationById(invitationId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${INVITATION_COLUMNS}
         FROM project_member_invitations
        WHERE id = $1
        LIMIT 1`, [invitationId]);
        return result.rows[0] ? this.mapInvitation(result.rows[0]) : null;
    }
    // ── Project members ─────────────────────────────────────────────────────────
    async listProjectMembers(projectId, query, client) {
        const db = client ?? this.db;
        const params = [projectId];
        const whereClauses = ["m.project_id = $1"];
        if (query.status) {
            params.push(query.status);
            whereClauses.push(`m.status = $${params.length}`);
        }
        else {
            whereClauses.push("m.status != 'removed'");
        }
        if (query.role) {
            params.push(query.role);
            whereClauses.push(`m.role = $${params.length}`);
        }
        if (query.search) {
            params.push(`%${query.search}%`);
            whereClauses.push(`(u.email ILIKE $${params.length} OR u.full_name ILIKE $${params.length})`);
        }
        const countResult = await db.query(`SELECT COUNT(*)::text AS count
         FROM project_members m
         LEFT JOIN users u ON u.id = m.user_id
        WHERE ${whereClauses.join(" AND ")}`, params);
        const sortColumnMap = {
            created_at: "m.created_at",
            updated_at: "m.updated_at",
            role: "m.role",
        };
        const sortColumn = sortColumnMap[query.sortBy];
        const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        params.push(query.limit, offset);
        const result = await db.query(`SELECT
         ${MEMBER_COLUMNS},
         u.email, u.full_name
       FROM project_members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE ${whereClauses.join(" AND ")}
       ORDER BY ${sortColumn} ${sortOrder}
       LIMIT $${params.length - 1}
       OFFSET $${params.length}`, params);
        return {
            members: result.rows.map((row) => this.mapMember(row)),
            total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
        };
    }
    async findProjectMemberByUserId(projectId, userId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT
         ${MEMBER_COLUMNS},
         u.email, u.full_name
       FROM project_members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.project_id = $1 AND m.user_id = $2
       LIMIT 1`, [projectId, userId]);
        return result.rows[0] ? this.mapMember(result.rows[0]) : null;
    }
    async findProjectMemberById(memberId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT
         ${MEMBER_COLUMNS},
         u.email, u.full_name
       FROM project_members m
       LEFT JOIN users u ON u.id = m.user_id
       WHERE m.id = $1
       LIMIT 1`, [memberId]);
        return result.rows[0] ? this.mapMember(result.rows[0]) : null;
    }
    async addProjectMember(projectId, organizationId, userId, role, addedByUserId, client) {
        const db = client ?? this.db;
        const roleId = await this.findRoleIdForSlug(organizationId, projectId, role, db);
        try {
            const result = await db.query(`INSERT INTO project_members (
           project_id, organization_id, user_id, role, role_id, status,
           added_by_user_id, added_at
         ) VALUES ($1, $2, $3, $4, $5, 'active', $6, NOW())
         RETURNING ${MEMBER_COLUMNS}`, [projectId, organizationId, userId, role, roleId, addedByUserId]);
            return this.mapMember(result.rows[0]);
        }
        catch (error) {
            if (error.code === "23505") {
                throw new ProjectError("MEMBER_EXISTS", "User is already a member of this project", 409);
            }
            throw error;
        }
    }
    async updateProjectMemberRole(memberId, role, client) {
        const db = client ?? this.db;
        const member = await this.findProjectMemberById(memberId, db);
        if (!member)
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found", 404);
        const roleId = await this.findRoleIdForSlug(member.organizationId, member.projectId, role, db);
        const result = await db.query(`UPDATE project_members
          SET role = $1, role_id = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'active'
        RETURNING ${MEMBER_COLUMNS}`, [role, roleId, memberId]);
        if (result.rowCount === 0) {
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found or removed", 404);
        }
        return this.mapMember(result.rows[0]);
    }
    async removeProjectMember(memberId, removedByUserId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_members
          SET status = 'removed', removed_by_user_id = $2, removed_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND status = 'active'
        RETURNING ${MEMBER_COLUMNS}`, [memberId, removedByUserId]);
        if (result.rowCount === 0) {
            throw new ProjectError("MEMBER_NOT_FOUND", "Member not found or already removed", 404);
        }
        return this.mapMember(result.rows[0]);
    }
    async transferOwnership(projectId, fromUserId, toUserId, actorUserId, client) {
        const db = client ?? this.db;
        const fromMember = await this.findProjectMemberByUserId(projectId, fromUserId, db);
        if (!fromMember || fromMember.role !== ProjectMemberRole.OWNER || fromMember.status !== "active") {
            throw new ProjectError("MEMBER_NOT_FOUND", "Current owner membership not found", 404);
        }
        let toMember = await this.findProjectMemberByUserId(projectId, toUserId, db);
        return db.query("SELECT 1").then(async () => {
            await db.query(`UPDATE project_members
            SET role = 'admin', role_id = (
              SELECT id FROM project_roles
               WHERE organization_id = $1 AND slug = 'admin' AND is_system = TRUE
               LIMIT 1
            ), updated_at = NOW()
          WHERE id = $2`, [fromMember.organizationId, fromMember.id]);
            if (toMember && toMember.status === "active") {
                const updated = await db.query(`UPDATE project_members
              SET role = 'owner', role_id = (
                SELECT id FROM project_roles
                 WHERE organization_id = $1 AND slug = 'owner' AND is_system = TRUE
                 LIMIT 1
              ), updated_at = NOW()
            WHERE id = $2
            RETURNING ${MEMBER_COLUMNS}`, [toMember.organizationId, toMember.id]);
                toMember = this.mapMember(updated.rows[0]);
            }
            else if (toMember && toMember.status === "removed") {
                const updated = await db.query(`UPDATE project_members
              SET role = 'owner', role_id = (
                SELECT id FROM project_roles
                 WHERE organization_id = $1 AND slug = 'owner' AND is_system = TRUE
                 LIMIT 1
              ), status = 'active', removed_by_user_id = NULL, removed_at = NULL,
              added_by_user_id = $3, added_at = NOW(), updated_at = NOW()
            WHERE id = $2
            RETURNING ${MEMBER_COLUMNS}`, [toMember.organizationId, toMember.id, actorUserId]);
                toMember = this.mapMember(updated.rows[0]);
            }
            else {
                toMember = await this.addProjectMember(projectId, fromMember.organizationId, toUserId, ProjectMemberRole.OWNER, actorUserId, db);
            }
            const fromUpdated = await this.findProjectMemberById(fromMember.id, db);
            if (!fromUpdated)
                throw new ProjectError("INTERNAL_ERROR", "Owner transfer failed", 500);
            return { fromMember: fromUpdated, toMember };
        });
    }
    // ── Invitations ─────────────────────────────────────────────────────────────
    async findPendingInvitationByToken(tokenHash, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${INVITATION_COLUMNS}
         FROM project_member_invitations
        WHERE token_hash = $1 AND status = 'pending'
        LIMIT 1`, [tokenHash]);
        return result.rows[0] ? this.mapInvitation(result.rows[0]) : null;
    }
    async findPendingInvitationByEmail(projectId, email, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${INVITATION_COLUMNS}
         FROM project_member_invitations
        WHERE project_id = $1 AND email = LOWER($2) AND status = 'pending'
        LIMIT 1`, [projectId, email]);
        return result.rows[0] ? this.mapInvitation(result.rows[0]) : null;
    }
    async createInvitation(projectId, organizationId, body, invitedByUserId, invitedUserId, expiresAt, client) {
        const db = client ?? this.db;
        const token = createInvitationToken();
        const tokenHash = hashInvitationToken(token);
        const email = body.email.toLowerCase();
        try {
            const result = await db.query(`INSERT INTO project_member_invitations (
           project_id, organization_id, email, invited_by_user_id, invited_user_id,
           role, status, token_hash, expires_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
         RETURNING ${INVITATION_COLUMNS}`, [projectId, organizationId, email, invitedByUserId, invitedUserId, body.role, tokenHash, expiresAt]);
            return { invitation: this.mapInvitation(result.rows[0]), token };
        }
        catch (error) {
            if (error.code === "23505") {
                throw new ProjectError("INVITATION_EXISTS", "An invitation already exists for this email", 409);
            }
            throw error;
        }
    }
    async updateInvitationToken(invitationId, expiresAt, client) {
        const db = client ?? this.db;
        const token = createInvitationToken();
        const tokenHash = hashInvitationToken(token);
        const result = await db.query(`UPDATE project_member_invitations
          SET token_hash = $1, expires_at = $2, updated_at = NOW()
        WHERE id = $3 AND status = 'pending'
        RETURNING ${INVITATION_COLUMNS}`, [tokenHash, expiresAt, invitationId]);
        if (result.rowCount === 0) {
            throw new ProjectError("INVITATION_NOT_FOUND", "Invitation not found", 404);
        }
        return { invitation: this.mapInvitation(result.rows[0]), token };
    }
    async acceptInvitation(invitationId, userId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_member_invitations
          SET status = 'accepted', invited_user_id = $2, accepted_at = NOW(),
              updated_at = NOW()
        WHERE id = $1 AND status = 'pending' AND expires_at > NOW()
        RETURNING ${INVITATION_COLUMNS}`, [invitationId, userId]);
        if (result.rowCount === 0) {
            throw new ProjectError("INVITATION_INVALID", "Invitation not found, expired, or already used", 400);
        }
        return this.mapInvitation(result.rows[0]);
    }
    async declineInvitation(invitationId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_member_invitations
          SET status = 'declined', declined_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING ${INVITATION_COLUMNS}`, [invitationId]);
        if (result.rowCount === 0) {
            throw new ProjectError("INVITATION_NOT_FOUND", "Invitation not found", 404);
        }
        return this.mapInvitation(result.rows[0]);
    }
    async cancelInvitation(invitationId, client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_member_invitations
          SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'pending'
        RETURNING ${INVITATION_COLUMNS}`, [invitationId]);
        if (result.rowCount === 0) {
            throw new ProjectError("INVITATION_NOT_FOUND", "Invitation not found", 404);
        }
        return this.mapInvitation(result.rows[0]);
    }
    async expireInvitations(client) {
        const db = client ?? this.db;
        const result = await db.query(`UPDATE project_member_invitations
          SET status = 'expired', updated_at = NOW()
        WHERE status = 'pending' AND expires_at <= NOW()`);
        return result.rowCount ?? 0;
    }
    async listProjectInvitations(projectId, query, client) {
        const db = client ?? this.db;
        const params = [projectId];
        const whereClauses = ["project_id = $1"];
        if (query.status) {
            params.push(query.status);
            whereClauses.push(`status = $${params.length}`);
        }
        if (query.email) {
            params.push(query.email.toLowerCase());
            whereClauses.push(`email = $${params.length}`);
        }
        const countResult = await db.query(`SELECT COUNT(*)::text AS count
         FROM project_member_invitations
        WHERE ${whereClauses.join(" AND ")}`, params);
        const sortColumnMap = {
            created_at: "created_at",
            updated_at: "updated_at",
            expires_at: "expires_at",
        };
        const sortColumn = sortColumnMap[query.sortBy];
        const sortOrder = query.sortOrder.toUpperCase() === "ASC" ? "ASC" : "DESC";
        const offset = query.offset ?? ((query.page ?? 1) - 1) * query.limit;
        params.push(query.limit, offset);
        const result = await db.query(`SELECT ${INVITATION_COLUMNS}
         FROM project_member_invitations
        WHERE ${whereClauses.join(" AND ")}
        ORDER BY ${sortColumn} ${sortOrder}
        LIMIT $${params.length - 1}
        OFFSET $${params.length}`, params);
        return {
            invitations: result.rows.map((row) => this.mapInvitation(row)),
            total: Number.parseInt(countResult.rows[0]?.count ?? "0", 10),
        };
    }
    // ── Custom roles ────────────────────────────────────────────────────────────
    async createRole(organizationId, projectId, body, client) {
        const db = client ?? this.db;
        try {
            const result = await db.query(`INSERT INTO project_roles (
           organization_id, project_id, name, slug, description, is_system,
           is_default, permissions
         ) VALUES ($1, $2, $3, $4, $5, FALSE, $6, $7)
         RETURNING ${ROLE_COLUMNS}`, [
                organizationId,
                projectId,
                body.name,
                body.slug,
                body.description ?? null,
                body.isDefault ?? false,
                body.permissions,
            ]);
            return this.mapRole(result.rows[0]);
        }
        catch (error) {
            if (error.code === "23505") {
                throw new ProjectError("ROLE_SLUG_EXISTS", "A role with this slug already exists in this project/organization", 409);
            }
            throw error;
        }
    }
    async updateRole(roleId, organizationId, body, client) {
        const db = client ?? this.db;
        const role = await this.findRoleById(roleId, organizationId, db);
        if (!role)
            throw new ProjectError("ROLE_NOT_FOUND", "Role not found", 404);
        if (role.isSystem) {
            throw new ProjectError("ROLE_IMMUTABLE", "System roles cannot be modified", 403);
        }
        const assignments = [];
        const values = [];
        let i = 1;
        if (body.name !== undefined) {
            assignments.push(`name = $${i++}`);
            values.push(body.name);
        }
        if (body.description !== undefined) {
            assignments.push(`description = $${i++}`);
            values.push(body.description);
        }
        if (body.permissions !== undefined) {
            assignments.push(`permissions = $${i++}`);
            values.push(body.permissions);
        }
        if (body.isDefault !== undefined) {
            assignments.push(`is_default = $${i++}`);
            values.push(body.isDefault);
        }
        if (assignments.length === 0)
            return role;
        assignments.push("updated_at = NOW()");
        values.push(roleId, organizationId);
        const result = await db.query(`UPDATE project_roles
          SET ${assignments.join(", ")}
        WHERE id = $${i++} AND organization_id = $${i++}
        RETURNING ${ROLE_COLUMNS}`, values);
        if (result.rowCount === 0) {
            throw new ProjectError("ROLE_NOT_FOUND", "Role not found", 404);
        }
        return this.mapRole(result.rows[0]);
    }
    async deleteRole(roleId, organizationId, client) {
        const db = client ?? this.db;
        const role = await this.findRoleById(roleId, organizationId, db);
        if (!role)
            throw new ProjectError("ROLE_NOT_FOUND", "Role not found", 404);
        if (role.isSystem) {
            throw new ProjectError("ROLE_IMMUTABLE", "System roles cannot be deleted", 403);
        }
        await db.query(`DELETE FROM project_roles WHERE id = $1 AND organization_id = $2`, [roleId, organizationId]);
    }
    async listRoles(organizationId, projectId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ROLE_COLUMNS}
         FROM project_roles
        WHERE organization_id = $1
          AND (
            project_id IS NULL
            OR project_id = $2
          )
        ORDER BY is_system DESC, name ASC`, [organizationId, projectId ?? null]);
        return result.rows.map((row) => this.mapRole(row));
    }
    async findRoleBySlug(organizationId, projectId, slug, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ROLE_COLUMNS}
         FROM project_roles
        WHERE organization_id = $1 AND slug = $2
          AND (project_id IS NULL OR project_id = $3)
        LIMIT 1`, [organizationId, slug, projectId ?? null]);
        return result.rows[0] ? this.mapRole(result.rows[0]) : null;
    }
    async findRoleById(roleId, organizationId, client) {
        const db = client ?? this.db;
        const result = await db.query(`SELECT ${ROLE_COLUMNS}
         FROM project_roles
        WHERE id = $1 AND organization_id = $2
        LIMIT 1`, [roleId, organizationId]);
        return result.rows[0] ? this.mapRole(result.rows[0]) : null;
    }
    async findRoleIdForSlug(organizationId, projectId, slug, client) {
        const result = await client.query(`SELECT id FROM project_roles
        WHERE organization_id = $1 AND slug = $2
          AND (project_id IS NULL OR project_id = $3)
        ORDER BY project_id NULLS LAST
        LIMIT 1`, [organizationId, slug, projectId]);
        return result.rows[0]?.id ?? null;
    }
    // ── Mapping helpers ─────────────────────────────────────────────────────────
    mapMember(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            userId: row.user_id,
            organizationId: row.organization_id,
            role: row.role,
            roleId: row.role_id,
            status: row.status,
            addedByUserId: row.added_by_user_id,
            addedAt: row.added_at,
            removedByUserId: row.removed_by_user_id,
            removedAt: row.removed_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            user: row.email
                ? {
                    id: row.user_id,
                    email: row.email,
                    fullName: row.full_name ?? "",
                }
                : undefined,
        };
    }
    mapInvitation(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            email: row.email,
            invitedByUserId: row.invited_by_user_id,
            invitedUserId: row.invited_user_id,
            role: row.role,
            status: row.status,
            expiresAt: row.expires_at,
            acceptedAt: row.accepted_at,
            declinedAt: row.declined_at,
            cancelledAt: row.cancelled_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    mapRole(row) {
        return {
            id: row.id,
            projectId: row.project_id,
            organizationId: row.organization_id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            isSystem: row.is_system,
            isDefault: row.is_default,
            permissions: row.permissions,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}
//# sourceMappingURL=member.repository.js.map