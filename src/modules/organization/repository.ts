/**
 * Organization repository.
 *
 * Flow:
 * 1. Execute all organization, member, invitation, billing-settings, and audit
 *    SQL through parameterized queries.
 * 2. Use explicit transactions for multi-table workflows such as organization
 *    creation, updates, and ownership transfer.
 * 3. Map database rows into module domain types so services do not depend on
 *    snake_case database columns.
 */
import type { Pool } from "pg";
import { pool } from "../../config/database.js";
import { generateSlug, sanitizeBillingAddress } from "./utils.js";
import {
  ConflictError,
  NotFoundError,
  type AddMemberRecord,
  type AuditAction,
  type AuditLog,
  type AuditResourceType,
  type CreateInvitationRecord,
  type CreateOrganizationRecord,
  type IOrganizationRepository,
  type OrgRole,
  type Organization,
  type OrganizationInvitation,
  type OrganizationMember,
  type SubscriptionStatus,
  type UpdateOrganizationRecord,
} from "./types.js";

type OrganizationReadRow = {
  id: string;
  name: string;
  slug: string;
  owner_user_id: string;
  description: string | null;
  org_status: Organization["status"];
  created_at: Date;
  updated_at: Date;
  logo_url: string | null;
  website_url: string | null;
 
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
  joined_method: OrganizationMember["joinedMethod"];
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
  org_id: string | null;
  user_id: string | null;
  action: AuditAction;
  resource_type: AuditResourceType;
  resource_id: string | null;
  metadata: Record<string, unknown> | null;
  ip_address: string;
  user_agent: string | null;
  created_at: Date;
};

type RowWithMemberRole = OrganizationReadRow & { member_role: OrgRole };

type BillingContact = {
  billingEmail: string;
  billingName: string | null;
  billingAddress: Organization["billingAddress"];
};

const ORGANIZATION_SELECT_COLUMNS = `
  o.id,
  o.name,
  o.slug,
  o.owner_user_id,
  o.status AS org_status,
  o.created_at,
  o.description,
  o. website_url,
  o.logo_url
`;

const ORGANIZATION_SELECT_JOINS = `
  FROM organizations o
  LEFT JOIN organization_settings os ON os.org_id = o.id
  LEFT JOIN organization_billing ob ON ob.org_id = o.id
`;

function asPgError(error: unknown): { code?: string } {
  return typeof error === "object" && error !== null
    ? (error as { code?: string })
    : {};
}

function parseBillingContact(invoiceNotes: string | null): BillingContact {
  // Billing contact data is currently serialized into invoice_notes. This parser
  // keeps invalid or legacy JSON from breaking organization reads.
  if (!invoiceNotes) {
    return { billingEmail: "", billingName: null, billingAddress: null };
  }

  try {
    const parsed = JSON.parse(invoiceNotes) as Partial<BillingContact>;
    return {
      billingEmail:
        typeof parsed.billingEmail === "string" ? parsed.billingEmail : "",
      billingName:
        typeof parsed.billingName === "string" ? parsed.billingName : null,
      billingAddress: sanitizeBillingAddress(parsed.billingAddress),
    };
  } catch {
    return { billingEmail: "", billingName: null, billingAddress: null };
  }
}

export class OrganizationRepository implements IOrganizationRepository {
  private readonly db: Pool;

  constructor(db: Pool = pool) {
    this.db = db;
  }

  async create(org: CreateOrganizationRecord): Promise<Organization> {
    // Organization creation is atomic: create org, owner membership, default
    // settings, starter billing, and initial usage row in one transaction.
    const client = await this.db.connect();

    console.log("Creating organization", org);
    try {
      await client.query("BEGIN");

      const existing = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
          SELECT 1
          FROM organizations
          WHERE owner_user_id = $1 AND deleted_at IS NULL
        )`,
        [org.ownerUserId],
      );

      if (existing.rows[0]?.exists) {
        throw new ConflictError("User already owns an organization");
      }
      console.log("existingcheckpassed")

      const baseSlug = generateSlug(org.name);
      let slug = baseSlug;
      let suffix = 1;

      while (true) {
        const slugCheck = await client.query<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = $1)",
          [slug],
        );

        if (!slugCheck.rows[0]?.exists) {
          break;
        }

        slug = `${baseSlug}-${suffix}`;
        suffix += 1;
      }

      const orgInsert = await client.query<{ id: string }>(
        `INSERT INTO organizations (name, slug, owner_user_id, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [org.name, slug, org.ownerUserId],
      );

      console.log("Organization insert result:", orgInsert.rows);
      const createdOrgId = orgInsert.rows[0]?.id;
      if (!createdOrgId) {
        throw new Error("Failed to create organization");
      }

   await client.query(
  `INSERT INTO organization_members (
    org_id,
    user_id,
    is_active,
    invited_by,
    invited_at,
    joined_method,
    last_active_at
  ) VALUES ($1, $2, $3, $4, NOW(), $5, NOW())`,
  [
    createdOrgId,
    org.ownerUserId,
    true,                 // is_active
    org.ownerUserId,      // invited_by (self for owner)
    'self_created'        // joined_method
  ],
);

console.log("member also created")

      await client.query(
        `INSERT INTO organization_settings (org_id)
         VALUES ($1)
         ON CONFLICT (org_id) DO NOTHING`,
        [createdOrgId],
      );

      console.log("settings also created")
      const planResult = await client.query<{ id: string; trial_days: number }>(
        `SELECT id, trial_days
         FROM billing_plans
         WHERE is_active = TRUE AND (tier = 'starter' OR id = 'starter')
         ORDER BY CASE WHEN id = 'starter' THEN 0 ELSE 1 END
         LIMIT 1`,
      );

      console.log("billing plan found",planResult)
      const plan = planResult.rows[0];
      if (!plan) {
        throw new Error("Starter billing plan is not configured");
      }

      const now = new Date();
      const trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + (plan.trial_days ?? 14));

      await client.query(
        `INSERT INTO organization_billing (
          org_id,
          plan_id,
          status,
          current_period_start,
          current_period_end,
          billing_cycle_anchor
        ) VALUES ($1, $2, 'trialing', $3, $4, $3)`,
        [createdOrgId, plan.id, now, trialEnd],
      );

      console.log("org billing generated")
      await client.query(
        `INSERT INTO organization_usage (
          org_id,
          metric_type,
          metric_name,
          period_start,
          period_end,
          granularity,
          usage_count
        ) VALUES ($1, 'api_requests', 'API requests', $2, $3, 'daily', 0)`,
        [createdOrgId, now, trialEnd],
      );

      console.log("org usuage create")
      await client.query("COMMIT");

      console.log(createdOrgId)
      const created = await this.findById(createdOrgId);
      if (!created) {
        throw new NotFoundError("Organization");
      }

      return created;
    } catch (error) {
      await client.query("ROLLBACK");

      const pgError = asPgError(error);
      if (pgError.code === "23505") {
        throw new ConflictError("Organization already exists");
      }

      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string, includeDeleted = false): Promise<Organization | null> {
  const result = await this.db.query<OrganizationReadRow>(
    `SELECT ${ORGANIZATION_SELECT_COLUMNS}
     FROM organizations o
     WHERE o.id = $1
     ${includeDeleted ? "" : "AND o.deleted_at IS NULL"}`,
    [id],
  );

  const row = result.rows[0];
  return row ? this.mapOrganization(row) : null;
}

  async findBySlug(slug: string): Promise<Organization | null> {
    const result = await this.db.query<OrganizationReadRow>(
      `SELECT ${ORGANIZATION_SELECT_COLUMNS}
       ${ORGANIZATION_SELECT_JOINS}
       WHERE o.slug = $1
         AND o.deleted_at IS NULL`,
      [slug],
    );

    const row = result.rows[0];
    return row ? this.mapOrganization(row) : null;
  }

  async findByUserId(
    userId: string,
  ):Promise<Array<{ id: string; name: string; logoUrl: string | null }>> {
   const result = await this.db.query<{
    id: string;
    name: string;
    logo_url: string | null;
  }>(
    `SELECT 
      o.id,
      o.name,
      o.logo_url
    FROM organization_members om
    INNER JOIN organizations o ON o.id = om.org_id
    WHERE om.user_id = $1
      AND om.is_active = TRUE
      AND o.deleted_at IS NULL
    ORDER BY o.created_at DESC`,
    [userId]
  );

  return result.rows.map(row => ({
    id: row.id,
    name: row.name,
    logoUrl: row.logo_url
  }));
}

  async update(id: string, data: UpdateOrganizationRecord): Promise<Organization> {
    // One service-level update can span organizations, organization_settings,
    // and organization_billing, so the repository fans fields out by owner table.
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      const orgExists = await client.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM organizations WHERE id = $1 AND deleted_at IS NULL)",
        [id],
      );

      if (!orgExists.rows[0]?.exists) {
        throw new NotFoundError("Organization");
      }

      const orgMap: Record<string, string> = {
        name: "name",
        description: "description",
        websiteUrl: "website_url",
        logoUrl: "logo_url",
        ownerUserId: "owner_user_id",
        status: "status",
        deletedAt: "deleted_at",
        deletedBy: "deleted_by",
      };

      const settingMap: Record<string, string> = {
        enforceSso: "enforce_sso",
        enforceMfa: "enforce_mfa",
        allowedEmailDomains: "allowed_email_domains",
        ipAllowlist: "ip_allowlist",
        sessionTimeoutMinutes: "session_timeout_minutes",
        dataRegion: "data_region",
        dataRetentionDays: "data_retention_days",
      };

      const billingMap: Record<string, string> = {
        billingStatus: "status",
        planId: "plan_id",
        planStartedAt: "current_period_start",
        planExpiresAt: "current_period_end",
        gracePeriodEndsAt: "grace_period_end",
      };

      const orgValues: Array<{ column: string; value: unknown }> = [];
      const settingValues: Array<{ column: string; value: unknown }> = [];
      const billingValues: Array<{ column: string; value: unknown }> = [];

      for (const [key, value] of Object.entries(data)) {
        if (value === undefined) {
          continue;
        }

        if (orgMap[key]) {
          orgValues.push({ column: orgMap[key], value });
          continue;
        }

        if (settingMap[key]) {
          settingValues.push({ column: settingMap[key], value });
          continue;
        }

        if (billingMap[key]) {
          billingValues.push({ column: billingMap[key], value });
        }
      }

      const hasBillingContactUpdate =
        data.billingEmail !== undefined ||
        data.billingName !== undefined ||
        data.billingAddress !== undefined;

      if (
        orgValues.length === 0 &&
        settingValues.length === 0 &&
        billingValues.length === 0 &&
        !hasBillingContactUpdate
      ) {
        throw new ConflictError("No fields to update");
      }

      const updateTable = async (
        table: string,
        idColumn: string,
        values: Array<{ column: string; value: unknown }>,
      ) => {
        // Table and column names come from internal maps above; values remain
        // parameterized to avoid SQL injection while supporting dynamic PATCHes.
        if (values.length === 0) {
          return;
        }

        const assignments = values.map(
          (value, index) => `${value.column} = $${index + 1}`,
        );
        assignments.push("updated_at = NOW()");

        await client.query(
          `UPDATE ${table}
           SET ${assignments.join(", ")}
           WHERE ${idColumn} = $${values.length + 1}`,
          [...values.map((value) => value.value), id],
        );
      };

      await updateTable("organizations", "id", orgValues);

      if (settingValues.length > 0) {
        await client.query(
          `INSERT INTO organization_settings (org_id)
           VALUES ($1)
           ON CONFLICT (org_id) DO NOTHING`,
          [id],
        );
        await updateTable("organization_settings", "org_id", settingValues);
      }

      if (billingValues.length > 0 || hasBillingContactUpdate) {
        await client.query(
          `INSERT INTO organization_billing (
            org_id,
            plan_id,
            status,
            current_period_start,
            current_period_end,
            billing_cycle_anchor
          ) VALUES ($1, 'starter', 'trialing', NOW(), NOW() + INTERVAL '14 days', NOW())
          ON CONFLICT (org_id) DO NOTHING`,
          [id],
        );

        if (hasBillingContactUpdate) {
          const currentNotes = await client.query<{ invoice_notes: string | null }>(
            "SELECT invoice_notes FROM organization_billing WHERE org_id = $1",
            [id],
          );

          const existing = parseBillingContact(currentNotes.rows[0]?.invoice_notes ?? null);
          const nextContact: BillingContact = {
            billingEmail: data.billingEmail ?? existing.billingEmail,
            billingName:
              data.billingName !== undefined
                ? data.billingName
                : existing.billingName,
            billingAddress:
              data.billingAddress !== undefined
                ? data.billingAddress
                : existing.billingAddress,
          };

          billingValues.push({
            column: "invoice_notes",
            value: JSON.stringify(nextContact),
          });
        }

        await updateTable("organization_billing", "org_id", billingValues);
      }

      await client.query("COMMIT");

      const updated = await this.findById(id);
      if (!updated) {
        throw new NotFoundError("Organization");
      }

      return updated;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async softDelete(id: string, deletedBy: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organizations
       SET deleted_at = NOW(), deleted_by = $1, status = 'cancelled', updated_at = NOW()
       WHERE id = $2 AND deleted_at IS NULL`,
      [deletedBy, id],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError("Organization");
    }
  }

  async restore(id: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organizations
       SET deleted_at = NULL, deleted_by = NULL, status = 'active', updated_at = NOW()
       WHERE id = $1`,
      [id],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError("Organization");
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
        member.lastActiveAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError("Member");
    }

    return this.mapMember(row);
  }

  async removeMember(
    orgId: string,
    userId: string,
    deactivatedBy: string,
    reason?: string,
  ): Promise<void> {
    const result = await this.db.query(
      `UPDATE organization_members
       SET is_active = FALSE,
           deactivated_at = NOW(),
           deactivated_by = $1,
           deactivation_reason = $2,
           updated_at = NOW()
       WHERE org_id = $3 AND user_id = $4 AND is_active = TRUE`,
      [deactivatedBy, reason ?? null, orgId, userId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError("Member");
    }
  }

  async findMember(orgId: string, userId: string): Promise<OrganizationMember | null> {
    const result = await this.db.query<MemberRow>(
      "SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2",
      [orgId, userId],
    );

    const row = result.rows[0];
    return row ? this.mapMember(row) : null;
  }

  async findMembersByOrgId(orgId: string): Promise<OrganizationMember[]> {
    const result = await this.db.query<MemberRow>(
      "SELECT * FROM organization_members WHERE org_id = $1 ORDER BY created_at ASC",
      [orgId],
    );

    return result.rows.map((row) => this.mapMember(row));
  }

  async updateMemberRole(orgId: string, userId: string, role: OrgRole): Promise<void> {
    const result = await this.db.query(
      `UPDATE organization_members
       SET role = $1, updated_at = NOW()
       WHERE org_id = $2 AND user_id = $3`,
      [role, orgId, userId],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError("Member");
    }
  }

  async transferOwnership(orgId: string, fromUserId: string, toUserId: string): Promise<void> {
    // Ownership transfer must update both membership roles and the organization
    // owner_user_id together.
    const client = await this.db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE organization_members
         SET role = 'admin', updated_at = NOW()
         WHERE org_id = $1 AND user_id = $2`,
        [orgId, fromUserId],
      );

      await client.query(
        `UPDATE organization_members
         SET role = 'owner', updated_at = NOW()
         WHERE org_id = $1 AND user_id = $2`,
        [orgId, toUserId],
      );

      await client.query(
        `UPDATE organizations
         SET owner_user_id = $1, updated_at = NOW()
         WHERE id = $2`,
        [toUserId, orgId],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async countActiveOwners(orgId: string): Promise<number> {
    const result = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM organization_members
       WHERE org_id = $1
         AND role = 'owner'
         AND is_active = TRUE`,
      [orgId],
    );

    return Number.parseInt(result.rows[0]?.count ?? "0", 10);
  }

  async createInvitation(invitation: CreateInvitationRecord): Promise<OrganizationInvitation> {
    // Persist only token_hash. The plaintext invitation token is returned by the
    // service once for email delivery or API response.
    const result = await this.db.query<InvitationRow>(
      `INSERT INTO organization_invitations (
        org_id,
        invited_by,
        email,
        role,
        token_hash,
        expires_at
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        invitation.orgId,
        invitation.invitedBy,
        invitation.email.toLowerCase(),
        invitation.role,
        invitation.tokenHash,
        invitation.expiresAt,
      ],
    );

    const row = result.rows[0];
    if (!row) {
      throw new NotFoundError("Invitation");
    }

    return this.mapInvitation(row);
  }

  async findInvitationById(id: string): Promise<OrganizationInvitation | null> {
    const result = await this.db.query<InvitationRow>(
      "SELECT * FROM organization_invitations WHERE id = $1",
      [id],
    );

    const row = result.rows[0];
    return row ? this.mapInvitation(row) : null;
  }

  async findInvitationByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null> {
    const result = await this.db.query<InvitationRow>(
      `SELECT *
       FROM organization_invitations
       WHERE token_hash = $1
         AND accepted_at IS NULL
         AND declined_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > NOW()`,
      [tokenHash],
    );

    const row = result.rows[0];
    return row ? this.mapInvitation(row) : null;
  }

  async findInvitationsByOrgId(
    orgId: string,
    status?: "pending" | "accepted" | "declined" | "revoked",
  ): Promise<OrganizationInvitation[]> {
    let query = "SELECT * FROM organization_invitations WHERE org_id = $1";

    if (status === "pending") {
      query +=
        " AND accepted_at IS NULL AND declined_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()";
    } else if (status === "accepted") {
      query += " AND accepted_at IS NOT NULL";
    } else if (status === "declined") {
      query += " AND declined_at IS NOT NULL";
    } else if (status === "revoked") {
      query += " AND revoked_at IS NOT NULL";
    }

    query += " ORDER BY created_at DESC";

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
      [acceptedBy, tokenHash],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError("Invitation");
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
      [tokenHash],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError("Invitation");
    }
  }

  async revokeInvitation(id: string, revokedBy: string): Promise<void> {
    const result = await this.db.query(
      `UPDATE organization_invitations
       SET revoked_at = NOW(), revoked_by = $1
       WHERE id = $2
         AND accepted_at IS NULL
         AND revoked_at IS NULL`,
      [revokedBy, id],
    );

    if (result.rowCount === 0) {
      throw new NotFoundError("Invitation");
    }
  }

  async incrementResentCount(id: string): Promise<void> {
    await this.db.query(
      `UPDATE organization_invitations
       SET resent_count = resent_count + 1, last_resent_at = NOW()
       WHERE id = $1`,
      [id],
    );
  }

  async createAuditLog(entry: Omit<AuditLog, "id" | "createdAt">): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (
        org_id,
        user_id,
        action,
        resource_type,
        resource_id,
        metadata,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.orgId,
        entry.userId,
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.metadata ? JSON.stringify(entry.metadata) : null,
        entry.ipAddress || "0.0.0.0",
        entry.userAgent,
      ],
    );
  }

  async findAuditLogs(orgId: string, limit = 50, offset = 0): Promise<AuditLog[]> {
    const result = await this.db.query<AuditLogRow>(
      `SELECT
         id,
         org_id,
         user_id,
         action,
         resource_type,
         resource_id,
         metadata,
         ip_address,
         user_agent,
         created_at
       FROM audit_logs
       WHERE org_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [orgId, limit, offset],
    );

    return result.rows.map((row) => this.mapAuditLog(row));
  }

  private mapOrganization(row: OrganizationReadRow): Organization {
    // Keep database naming isolated in the repository. The rest of the module
    // consumes camelCase Organization objects.
    // const billingContact = parseBillingContact(row.invoice_notes);

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description || null,
      logoUrl: row.logo_url || null,
      websiteUrl: row.website_url || null,
      ownerUserId: row.owner_user_id,
      status: row.org_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
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
      updatedAt: row.updated_at,
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
      createdAt: row.created_at,
    };
  }

  private mapAuditLog(row: AuditLogRow): AuditLog {
    return {
      id: row.id,
      orgId: row.org_id,
      userId: row.user_id,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: row.metadata,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
    };
  }
}
