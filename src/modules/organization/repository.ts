import type { Pool } from 'pg';
import { pool } from '../../config/database.js';
import {
  ConflictError,
  NotFoundError,
  type AddMemberRecord,
  type AuditLog,
  type CreateInvitationRecord,
  type CreateOrganizationRecord,
  type IOrganizationRepository,
  type OrgRole,
  type Organization,
  type OrganizationInvitation,
  type OrganizationMember,
  type UpdateOrganizationRecord
} from './types.js';

type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logo_url: string | null;
  website_url: string | null;
  owner_user_id: string;
  billing_email: string;
  billing_name: string | null;
  billing_address: unknown;
  plan_id: string;
  plan_started_at: Date;
  plan_expires_at: Date | null;
  status: Organization['status'];
  trial_started_at: Date | null;
  trial_ends_at: Date | null;
  grace_period_ends_at: Date | null;
  enforce_sso: boolean;
  enforce_mfa: boolean;
  allowed_email_domains: string[] | null;
  ip_allowlist: string[] | null;
  session_timeout_minutes: number;
  data_region: string;
  data_retention_days: number;
  deleted_at: Date | null;
  deleted_by: string | null;
  created_at: Date;
  updated_at: Date;
};

type MemberRow = {
  id: string;
  org_id: string;
  user_id: string;
  role: OrgRole;
  permissions: Record<string, boolean> | null;
  is_active: boolean;
  deactivated_at: Date | null;
  deactivated_by: string | null;
  deactivation_reason: string | null;
  invited_by: string | null;
  invited_at: Date | null;
  joined_at: Date;
  joined_method: OrganizationMember['joinedMethod'];
  last_active_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type InvitationRow = {
  id: string;
  org_id: string;
  invited_by: string;
  email: string;
  email_hash: string;
  role: OrgRole;
  token_hash: string;
  expires_at: Date;
  accepted_at: Date | null;
  accepted_by: string | null;
  declined_at: Date | null;
  revoked_at: Date | null;
  revoked_by: string | null;
  resent_count: number;
  last_resent_at: Date | null;
  created_at: Date;
};

type AuditLogRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: Date;
};

function asPgError(error: unknown): { code?: string } {
  return typeof error === 'object' && error !== null ? (error as { code?: string }) : {};
}

export class OrganizationRepository implements IOrganizationRepository {
  private readonly db: Pool;

  constructor(db: Pool = pool) {
    this.db = db;
  }

  async create(org: CreateOrganizationRecord): Promise<Organization> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      const existing = await client.query<{ id: string }>(
        'SELECT id FROM organizations WHERE slug = $1 AND deleted_at IS NULL FOR UPDATE',
        [org.slug]
      );

      if (existing.rows.length > 0) {
        throw new ConflictError(`Organization with slug "${org.slug}" already exists`);
      }

      const orgResult = await client.query<OrganizationRow>(
        `INSERT INTO organizations (
          name,
          slug,
          description,
          website_url,
          owner_user_id,
          billing_email,
          billing_name,
          billing_address,
          plan_id,
          plan_started_at,
          status,
          trial_started_at,
          trial_ends_at,
          enforce_sso,
          enforce_mfa,
          allowed_email_domains,
          ip_allowlist,
          session_timeout_minutes,
          data_region,
          data_retention_days
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20
        )
        RETURNING *`,
        [
          org.name,
          org.slug,
          org.description,
          org.websiteUrl,
          org.ownerUserId,
          org.billingEmail,
          org.billingName,
          org.billingAddress ? JSON.stringify(org.billingAddress) : null,
          org.planId,
          org.planStartedAt,
          org.status,
          org.trialStartedAt,
          org.trialEndsAt,
          org.enforceSso,
          org.enforceMfa,
          org.allowedEmailDomains,
          org.ipAllowlist,
          org.sessionTimeoutMinutes,
          org.dataRegion,
          org.dataRetentionDays
        ]
      );

      const createdRow = orgResult.rows[0];
      if (!createdRow) {
        throw new NotFoundError('Organization');
      }

      const newOrg = this.mapOrganization(createdRow);

      await client.query(
        `INSERT INTO organization_members (
          org_id,
          user_id,
          role,
          permissions,
          is_active,
          invited_by,
          invited_at,
          joined_method,
          last_active_at
        ) VALUES ($1, $2, $3, $4, true, $5, NOW(), $6, NOW())`,
        [
          newOrg.id,
          org.ownerUserId,
          'owner',
          JSON.stringify({ 'billing:manage': true, 'settings:edit': true }),
          org.ownerUserId,
          'admin_add'
        ]
      );

      await client.query('COMMIT');
      return newOrg;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if (error instanceof ConflictError) {
        throw error;
      }

      const pgError = asPgError(error);
      if (pgError.code === '23505') {
        throw new ConflictError('Organization already exists');
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string, includeDeleted = false): Promise<Organization | null> {
    const result = await this.db.query<OrganizationRow>(
      `SELECT * FROM organizations WHERE id = $1 ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`,
      [id]
    );

    return result.rows[0] ? this.mapOrganization(result.rows[0]) : null;
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const result = await this.db.query<OrganizationRow>(
      'SELECT * FROM organizations WHERE slug = $1 AND deleted_at IS NULL',
      [slug]
    );

    return result.rows[0] ? this.mapOrganization(result.rows[0]) : null;
  }

  async findByUserId(userId: string): Promise<Array<Organization & { memberRole: OrgRole }>> {
    const result = await this.db.query<OrganizationRow & { member_role: OrgRole }>(
      `SELECT o.*, om.role AS member_role
       FROM organizations o
       JOIN organization_members om ON o.id = om.org_id
       WHERE om.user_id = $1
         AND om.is_active = TRUE
         AND o.deleted_at IS NULL
       ORDER BY o.created_at DESC`,
      [userId]
    );

    return result.rows.map((row) => ({
      ...this.mapOrganization(row),
      memberRole: row.member_role
    }));
  }

  async update(id: string, data: UpdateOrganizationRecord): Promise<Organization> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    const map: Record<keyof UpdateOrganizationRecord, string> = {
      name: 'name',
      description: 'description',
      websiteUrl: 'website_url',
      ownerUserId: 'owner_user_id',
      billingEmail: 'billing_email',
      billingName: 'billing_name',
      billingAddress: 'billing_address',
      planId: 'plan_id',
      planStartedAt: 'plan_started_at',
      planExpiresAt: 'plan_expires_at',
      status: 'status',
      trialStartedAt: 'trial_started_at',
      trialEndsAt: 'trial_ends_at',
      gracePeriodEndsAt: 'grace_period_ends_at',
      enforceSso: 'enforce_sso',
      enforceMfa: 'enforce_mfa',
      allowedEmailDomains: 'allowed_email_domains',
      ipAllowlist: 'ip_allowlist',
      sessionTimeoutMinutes: 'session_timeout_minutes',
      dataRegion: 'data_region',
      dataRetentionDays: 'data_retention_days',
      deletedAt: 'deleted_at',
      deletedBy: 'deleted_by',
      logoUrl: 'logo_url'
    };

    const entries = Object.entries(data) as Array<[keyof UpdateOrganizationRecord, unknown]>;

    for (const [key, value] of entries) {
      if (value === undefined) {
        continue;
      }

      fields.push(`${map[key]} = $${index}`);
      if (key === 'billingAddress') {
        values.push(value === null ? null : JSON.stringify(value));
      } else {
        values.push(value);
      }
      index += 1;
    }

    if (fields.length === 0) {
      throw new ConflictError('No fields to update');
    }

    fields.push('updated_at = NOW()');

    const result = await this.db.query<OrganizationRow>(
      `UPDATE organizations
       SET ${fields.join(', ')}
       WHERE id = $${index} AND deleted_at IS NULL
       RETURNING *`,
      [...values, id]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Organization');
    }

    const updatedRow = result.rows[0];
    if (!updatedRow) {
      throw new NotFoundError('Organization');
    }

    return this.mapOrganization(updatedRow);
  }

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organizations
       SET deleted_at = NOW(), deleted_by = $1, status = 'cancelled', updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL`,
      [deletedBy, id]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Organization');
    }
  }

  async restore(id: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organizations
       SET deleted_at = NULL, deleted_by = NULL, status = 'active', updated_at = NOW()
       WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Organization');
    }
  }

  async addMember(member: AddMemberRecord): Promise<OrganizationMember> {
    const result = await this.db.query<MemberRow>(
      `INSERT INTO organization_members (
        org_id,
        user_id,
        role,
        permissions,
        is_active,
        invited_by,
        invited_at,
        joined_method,
        last_active_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (org_id, user_id)
      DO UPDATE SET
        role = EXCLUDED.role,
        permissions = EXCLUDED.permissions,
        is_active = TRUE,
        deactivated_at = NULL,
        deactivated_by = NULL,
        deactivation_reason = NULL,
        invited_by = EXCLUDED.invited_by,
        invited_at = EXCLUDED.invited_at,
        joined_method = EXCLUDED.joined_method,
        last_active_at = EXCLUDED.last_active_at,
        updated_at = NOW()
      RETURNING *`,
      [
        member.orgId,
        member.userId,
        member.role,
        JSON.stringify(member.permissions),
        member.isActive,
        member.invitedBy,
        member.invitedAt,
        member.joinedMethod,
        member.lastActiveAt
      ]
    );

    const memberRow = result.rows[0];
    if (!memberRow) {
      throw new NotFoundError('Member');
    }

    return this.mapMember(memberRow);
  }

  async removeMember(orgId: string, userId: string, deactivatedBy: string, reason?: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organization_members
       SET is_active = FALSE,
           deactivated_at = NOW(),
           deactivated_by = $1,
           deactivation_reason = $2,
           updated_at = NOW()
       WHERE org_id = $3 AND user_id = $4 AND is_active = TRUE`,
      [deactivatedBy, reason ?? null, orgId, userId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Member');
    }
  }

  async findMember(orgId: string, userId: string): Promise<OrganizationMember | null> {
    const result = await this.db.query<MemberRow>(
      'SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2',
      [orgId, userId]
    );

    return result.rows[0] ? this.mapMember(result.rows[0]) : null;
  }

  async findMembersByOrgId(orgId: string): Promise<OrganizationMember[]> {
    const result = await this.db.query<MemberRow>(
      'SELECT * FROM organization_members WHERE org_id = $1 ORDER BY created_at ASC',
      [orgId]
    );

    return result.rows.map((row) => this.mapMember(row));
  }

  async updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
    const result = await this.db.query(
      'UPDATE organization_members SET role = $1, updated_at = NOW() WHERE org_id = $2 AND user_id = $3',
      [role, orgId, userId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Member');
    }
  }

  async transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void> {
    const client = await this.db.connect();

    try {
      await client.query('BEGIN');

      await client.query(
        "UPDATE organization_members SET role = 'admin', updated_at = NOW() WHERE org_id = $1 AND user_id = $2",
        [orgId, fromUserId]
      );

      await client.query(
        "UPDATE organization_members SET role = 'owner', updated_at = NOW() WHERE org_id = $1 AND user_id = $2",
        [orgId, toUserId]
      );

      await client.query(
        'UPDATE organizations SET owner_user_id = $1, updated_at = NOW() WHERE id = $2',
        [toUserId, orgId]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async countActiveOwners(orgId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND is_active = TRUE",
      [orgId]
    );

    const countRow = result.rows[0];
    return Number.parseInt(countRow?.count ?? '0', 10);
  }

  async createInvitation(invitation: CreateInvitationRecord): Promise<OrganizationInvitation> {
    const result = await this.db.query<InvitationRow>(
      `INSERT INTO organization_invitations (
        org_id,
        invited_by,
        email,
        email_hash,
        role,
        token_hash,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        invitation.orgId,
        invitation.invitedBy,
        invitation.email.toLowerCase(),
        invitation.emailHash,
        invitation.role,
        invitation.tokenHash,
        invitation.expiresAt
      ]
    );

    const invitationRow = result.rows[0];
    if (!invitationRow) {
      throw new NotFoundError('Invitation');
    }

    return this.mapInvitation(invitationRow);
  }

  async findInvitationById(id: string): Promise<OrganizationInvitation | null> {
    const result = await this.db.query<InvitationRow>('SELECT * FROM organization_invitations WHERE id = $1', [id]);
    return result.rows[0] ? this.mapInvitation(result.rows[0]) : null;
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null> {
    const result = await this.db.query<InvitationRow>(
      `SELECT * FROM organization_invitations
       WHERE token_hash = $1
         AND accepted_at IS NULL
         AND declined_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [tokenHash]
    );

    return result.rows[0] ? this.mapInvitation(result.rows[0]) : null;
  }

  async findInvitationsByOrgId(
    orgId: string,
    status?: 'pending' | 'accepted' | 'declined' | 'revoked'
  ): Promise<OrganizationInvitation[]> {
    let query = 'SELECT * FROM organization_invitations WHERE org_id = $1';

    if (status === 'pending') {
      query += ' AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()';
    } else if (status === 'accepted') {
      query += ' AND accepted_at IS NOT NULL';
    } else if (status === 'declined') {
      query += ' AND declined_at IS NOT NULL';
    } else if (status === 'revoked') {
      query += ' AND revoked_at IS NOT NULL';
    }

    query += ' ORDER BY created_at DESC';

    const result = await this.db.query<InvitationRow>(query, [orgId]);
    return result.rows.map((row) => this.mapInvitation(row));
  }

  async acceptInvitation(tokenHash: string, acceptedBy: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organization_invitations
       SET accepted_at = NOW(), accepted_by = $1
       WHERE token_hash = $2
         AND accepted_at IS NULL
         AND declined_at IS NULL
         AND revoked_at IS NULL`,
      [acceptedBy, tokenHash]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Invitation');
    }
  }

  async declineInvitation(tokenHash: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organization_invitations
       SET declined_at = NOW()
       WHERE token_hash = $1
         AND accepted_at IS NULL
         AND declined_at IS NULL
         AND revoked_at IS NULL`,
      [tokenHash]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Invitation');
    }
  }

  async revokeInvitation(id: string, revokedBy: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organization_invitations
       SET revoked_at = NOW(), revoked_by = $1
       WHERE id = $2
         AND accepted_at IS NULL
         AND revoked_at IS NULL`,
      [revokedBy, id]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Invitation');
    }
  }

  async incrementResentCount(id: string): Promise<void> {
    await this.db.query(
      `UPDATE organization_invitations
       SET resent_count = resent_count + 1, last_resent_at = NOW()
       WHERE id = $1`,
      [id]
    );
  }

  async createAuditLog(entry: Omit<AuditLog, 'id' | 'createdAt'>): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (
        org_id,
        user_id,
        action,
        entity_type,
        entity_id,
        metadata,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.orgId,
        entry.userId,
        entry.action,
        entry.entityType,
        entry.entityId,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.ipAddress,
        entry.userAgent
      ]
    );
  }

  async findAuditLogs(orgId: string, limit = 50, offset = 0): Promise<AuditLog[]> {
    const result = await this.db.query<AuditLogRow>(
      `SELECT * FROM audit_logs
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, limit, offset]
    );

    return result.rows.map((row) => this.mapAuditLog(row));
  }

  private mapOrganization(row: OrganizationRow): Organization {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      logoUrl: row.logo_url,
      websiteUrl: row.website_url,
      ownerUserId: row.owner_user_id,
      billingEmail: row.billing_email,
      billingName: row.billing_name,
      billingAddress: (row.billing_address as Organization['billingAddress']) ?? null,
      planId: row.plan_id,
      planStartedAt: row.plan_started_at,
      planExpiresAt: row.plan_expires_at,
      status: row.status,
      trialStartedAt: row.trial_started_at,
      trialEndsAt: row.trial_ends_at,
      gracePeriodEndsAt: row.grace_period_ends_at,
      enforceSso: row.enforce_sso,
      enforceMfa: row.enforce_mfa,
      allowedEmailDomains: row.allowed_email_domains,
      ipAllowlist: row.ip_allowlist,
      sessionTimeoutMinutes: row.session_timeout_minutes,
      dataRegion: row.data_region,
      dataRetentionDays: row.data_retention_days,
      deletedAt: row.deleted_at,
      deletedBy: row.deleted_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapMember(row: MemberRow): OrganizationMember {
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      role: row.role,
      permissions: row.permissions ?? {},
      isActive: row.is_active,
      deactivatedAt: row.deactivated_at,
      deactivatedBy: row.deactivated_by,
      deactivationReason: row.deactivation_reason,
      invitedBy: row.invited_by,
      invitedAt: row.invited_at,
      joinedAt: row.joined_at,
      joinedMethod: row.joined_method,
      lastActiveAt: row.last_active_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private mapInvitation(row: InvitationRow): OrganizationInvitation {
    return {
      id: row.id,
      orgId: row.org_id,
      invitedBy: row.invited_by,
      email: row.email,
      emailHash: row.email_hash,
      role: row.role,
      tokenHash: row.token_hash,
      expiresAt: row.expires_at,
      acceptedAt: row.accepted_at,
      acceptedBy: row.accepted_by,
      declinedAt: row.declined_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      resentCount: row.resent_count,
      lastResentAt: row.last_resent_at,
      createdAt: row.created_at
    };
  }

  private mapAuditLog(row: AuditLogRow): AuditLog {
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      metadata: row.metadata,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at
    };
  }
}
