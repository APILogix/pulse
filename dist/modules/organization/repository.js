import { pool } from "../../config/database.js";
import { generateSlug, sanitizeBillingAddress } from "./utils.js";
import { ConflictError, NotFoundError, } from "./types.js";
const ORGANIZATION_COLUMNS = `
  o.id,
  o.name,
  o.slug,
  o.description,
  o.logo_url,
  o.website_url,
  o.owner_user_id,
  o.status AS org_status,
  o.deleted_at,
  o.created_at,
  o.updated_at,
  ob.status AS billing_status,
  ob.invoice_notes,
  ob.plan_id,
  ob.current_period_start,
  ob.current_period_end,
  ob.current_period_end AS trial_ends_at,
  ob.grace_period_end,
  os.enforce_sso,
  os.enforce_mfa,
  os.allowed_email_domains,
  os.ip_allowlist::TEXT[] AS ip_allowlist,
  os.session_timeout_minutes,
  os.data_region,
  os.data_retention_days
`;
const ORGANIZATION_FROM = `
  FROM organizations o
  LEFT JOIN organization_billing ob ON ob.org_id = o.id
  LEFT JOIN organization_settings os ON os.org_id = o.id
`;
const MEMBER_COLUMNS = `
  om.id,
  om.org_id,
  om.user_id,
  u.email,
  u.full_name,
  CASE
    WHEN o.owner_user_id = om.user_id THEN 'admin'
    ELSE 'member'
  END::text AS role,
  om.is_active,
  om.created_at,
  om.last_active_at
`;
const MEMBER_FROM = `
  FROM organization_members om
  JOIN organizations o ON o.id = om.org_id
  JOIN users u ON u.id = om.user_id
`;
const INVITATION_PUBLIC_COLUMNS = `
  oi.id,
  oi.org_id,
  oi.invited_by,
  inviter.email AS invited_by_email,
  inviter.full_name AS invited_by_name,
  oi.email,
  CASE WHEN oi.role = 'admin' THEN 'admin' ELSE 'member' END::text AS role,
  oi.expires_at,
  oi.accepted_at,
  oi.accepted_by,
  oi.declined_at,
  oi.revoked_at,
  oi.revoked_by,
  oi.resent_count,
  oi.last_resent_at,
  oi.created_at
`;
const INVITATION_FROM = `
  FROM organization_invitations oi
  LEFT JOIN users inviter ON inviter.id = oi.invited_by
`;
function asPgError(error) {
    return typeof error === "object" && error !== null
        ? error
        : {};
}
function parseBillingContact(invoiceNotes) {
    if (!invoiceNotes) {
        return { billingEmail: "", billingName: null, billingAddress: null };
    }
    try {
        const parsed = JSON.parse(invoiceNotes);
        return {
            billingEmail: typeof parsed.billingEmail === "string" ? parsed.billingEmail : "",
            billingName: typeof parsed.billingName === "string" ? parsed.billingName : null,
            billingAddress: sanitizeBillingAddress(parsed.billingAddress),
        };
    }
    catch {
        return { billingEmail: "", billingName: null, billingAddress: null };
    }
}
function pagination(rows, total, input) {
    return {
        data: rows,
        pagination: {
            total,
            limit: input.limit,
            offset: input.offset,
        },
    };
}
export class OrganizationRepository {
    db;
    constructor(db = pool) {
        this.db = db;
    }
    async create(org) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const existing = await client.query(`SELECT EXISTS(
          SELECT 1
          FROM organizations
          WHERE owner_user_id = $1 AND deleted_at IS NULL
        )`, [org.ownerUserId]);
            if (existing.rows[0]?.exists) {
                throw new ConflictError("User already owns an organization");
            }
            const baseSlug = generateSlug(org.name);
            let slug = baseSlug;
            let suffix = 1;
            while (true) {
                const slugCheck = await client.query("SELECT EXISTS(SELECT 1 FROM organizations WHERE slug = $1)", [slug]);
                if (!slugCheck.rows[0]?.exists) {
                    break;
                }
                slug = `${baseSlug}-${suffix}`;
                suffix += 1;
            }
            const orgInsert = await client.query(`INSERT INTO organizations (name, slug, owner_user_id, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`, [org.name, slug, org.ownerUserId]);
            const createdOrgId = orgInsert.rows[0]?.id;
            if (!createdOrgId) {
                throw new Error("Failed to create organization");
            }
            await client.query(`INSERT INTO organization_members (
          org_id,
          user_id,
          is_active,
          invited_by,
          invited_at,
          joined_method,
          last_active_at
        ) VALUES ($1, $2, TRUE, $2, NOW(), 'self_created', NOW())`, [createdOrgId, org.ownerUserId]);
            await client.query(`INSERT INTO organization_settings (org_id)
         VALUES ($1)
         ON CONFLICT (org_id) DO NOTHING`, [createdOrgId]);
            const planResult = await client.query(`SELECT id, trial_days
         FROM billing_plans
         WHERE is_active = TRUE AND (tier = 'starter' OR id = 'starter')
         ORDER BY CASE WHEN id = 'starter' THEN 0 ELSE 1 END
         LIMIT 1`);
            const plan = planResult.rows[0];
            if (!plan) {
                throw new Error("Starter billing plan is not configured");
            }
            const now = new Date();
            const trialEnd = new Date(now);
            trialEnd.setDate(trialEnd.getDate() + (plan.trial_days ?? 14));
            await client.query(`INSERT INTO organization_billing (
          org_id,
          plan_id,
          status,
          current_period_start,
          current_period_end,
          billing_cycle_anchor
        ) VALUES ($1, $2, 'trialing', $3, $4, $3)`, [createdOrgId, plan.id, now, trialEnd]);
            await client.query(`INSERT INTO organization_usage (
          org_id,
          metric_type,
          metric_name,
          period_start,
          period_end,
          granularity,
          usage_count
        ) VALUES ($1, 'api_requests', 'API requests', $2, $3, 'daily', 0)`, [createdOrgId, now, trialEnd]);
            await client.query("COMMIT");
            const created = await this.findById(createdOrgId);
            if (!created) {
                throw new NotFoundError("Organization");
            }
            return created;
        }
        catch (error) {
            await client.query("ROLLBACK");
            if (asPgError(error).code === "23505") {
                throw new ConflictError("Organization already exists");
            }
            throw error;
        }
        finally {
            client.release();
        }
    }
    async findById(id, includeDeleted = false) {
        const result = await this.db.query(`SELECT ${ORGANIZATION_COLUMNS}
       ${ORGANIZATION_FROM}
       WHERE o.id = $1
       ${includeDeleted ? "" : "AND o.deleted_at IS NULL"}`, [id]);
        const row = result.rows[0];
        return row ? this.mapOrganization(row) : null;
    }
    async findBySlug(slug) {
        const result = await this.db.query(`SELECT ${ORGANIZATION_COLUMNS}
       ${ORGANIZATION_FROM}
       WHERE o.slug = $1 AND o.deleted_at IS NULL`, [slug]);
        const row = result.rows[0];
        return row ? this.mapOrganization(row) : null;
    }
    async findByUserId(userId, input) {
        const [totalResult, rowsResult] = await Promise.all([
            this.db.query(`SELECT COUNT(*)::text AS total
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.user_id = $1
           AND om.is_active = TRUE
           AND o.deleted_at IS NULL`, [userId]),
            this.db.query(`SELECT
           o.id,
           o.name,
           o.slug,
           o.logo_url,
           CASE WHEN o.owner_user_id = om.user_id THEN 'admin' ELSE 'member' END::text AS role,
           o.created_at
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.user_id = $1
           AND om.is_active = TRUE
           AND o.deleted_at IS NULL
         ORDER BY o.created_at DESC
         LIMIT $2 OFFSET $3`, [userId, input.limit, input.offset]),
        ]);
        return pagination(rowsResult.rows.map((row) => ({
            id: row.id,
            name: row.name,
            slug: row.slug,
            logoUrl: row.logo_url,
            role: row.role,
            createdAt: row.created_at,
        })), Number.parseInt(totalResult.rows[0]?.total ?? "0", 10), input);
    }
    async update(id, data) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const orgExists = await client.query(`SELECT EXISTS(
          SELECT 1 FROM organizations WHERE id = $1 AND deleted_at IS NULL
        )`, [id]);
            if (!orgExists.rows[0]?.exists) {
                throw new NotFoundError("Organization");
            }
            const orgMap = {
                name: "name",
                description: "description",
                websiteUrl: "website_url",
                logoUrl: "logo_url",
                ownerUserId: "owner_user_id",
                status: "status",
                deletedAt: "deleted_at",
            };
            const settingMap = {
                enforceSso: "enforce_sso",
                enforceMfa: "enforce_mfa",
                allowedEmailDomains: "allowed_email_domains",
                ipAllowlist: "ip_allowlist",
                sessionTimeoutMinutes: "session_timeout_minutes",
                dataRegion: "data_region",
                dataRetentionDays: "data_retention_days",
            };
            const billingMap = {
                billingStatus: "status",
                planId: "plan_id",
                planStartedAt: "current_period_start",
                planExpiresAt: "current_period_end",
                gracePeriodEndsAt: "grace_period_end",
            };
            const orgValues = [];
            const settingValues = [];
            const billingValues = [];
            const hasBillingContactUpdate = data.billingEmail !== undefined ||
                data.billingName !== undefined ||
                data.billingAddress !== undefined;
            for (const [key, value] of Object.entries(data)) {
                if (value === undefined) {
                    continue;
                }
                if (orgMap[key]) {
                    orgValues.push({ column: orgMap[key], value });
                }
                else if (settingMap[key]) {
                    settingValues.push({ column: settingMap[key], value });
                }
                else if (billingMap[key]) {
                    billingValues.push({ column: billingMap[key], value });
                }
            }
            if (orgValues.length === 0 &&
                settingValues.length === 0 &&
                billingValues.length === 0 &&
                !hasBillingContactUpdate) {
                throw new ConflictError("No fields to update");
            }
            const updateTable = async (table, idColumn, values) => {
                if (values.length === 0) {
                    return;
                }
                const assignments = values.map((value, index) => `${value.column} = $${index + 1}`);
                assignments.push("updated_at = NOW()");
                await client.query(`UPDATE ${table}
           SET ${assignments.join(", ")}
           WHERE ${idColumn} = $${values.length + 1}`, [...values.map((value) => value.value), id]);
            };
            await updateTable("organizations", "id", orgValues);
            if (settingValues.length > 0) {
                await client.query(`INSERT INTO organization_settings (org_id)
           VALUES ($1)
           ON CONFLICT (org_id) DO NOTHING`, [id]);
                await updateTable("organization_settings", "org_id", settingValues);
            }
            if (billingValues.length > 0 || hasBillingContactUpdate) {
                await client.query(`INSERT INTO organization_billing (
            org_id,
            plan_id,
            status,
            current_period_start,
            current_period_end,
            billing_cycle_anchor
          ) VALUES ($1, 'starter', 'trialing', NOW(), NOW() + INTERVAL '14 days', NOW())
          ON CONFLICT (org_id) DO NOTHING`, [id]);
                if (hasBillingContactUpdate) {
                    const currentNotes = await client.query(`SELECT invoice_notes
             FROM organization_billing
             WHERE org_id = $1`, [id]);
                    const existingContact = parseBillingContact(currentNotes.rows[0]?.invoice_notes ?? null);
                    billingValues.push({
                        column: "invoice_notes",
                        value: JSON.stringify({
                            billingEmail: data.billingEmail ?? existingContact.billingEmail,
                            billingName: data.billingName !== undefined
                                ? data.billingName
                                : existingContact.billingName,
                            billingAddress: data.billingAddress !== undefined
                                ? data.billingAddress
                                : existingContact.billingAddress,
                        }),
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
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async softDelete(id, _deletedBy) {
        const result = await this.db.query(`UPDATE organizations
       SET deleted_at = NOW(),
           status = 'cancelled',
           updated_at = NOW()
       WHERE id = $1 AND deleted_at IS NULL`, [id]);
        if (result.rowCount === 0) {
            throw new NotFoundError("Organization");
        }
    }
    async restore(id) {
        const result = await this.db.query(`UPDATE organizations
       SET deleted_at = NULL,
           status = 'active',
           updated_at = NOW()
       WHERE id = $1`, [id]);
        if (result.rowCount === 0) {
            throw new NotFoundError("Organization");
        }
    }
    async addMember(member) {
        const result = await this.db.query(`WITH upserted AS (
        INSERT INTO organization_members (
          org_id,
          user_id,
          is_active,
          invited_by,
          invited_at,
          joined_method,
          last_active_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (org_id, user_id)
        DO UPDATE SET
          is_active = TRUE,
          deactivated_at = NULL,
          deactivated_by = NULL,
          deactivation_reason = NULL,
          invited_by = EXCLUDED.invited_by,
          invited_at = EXCLUDED.invited_at,
          joined_method = EXCLUDED.joined_method,
          last_active_at = EXCLUDED.last_active_at,
          updated_at = NOW()
        RETURNING id, org_id, user_id, is_active, created_at, last_active_at
      )
      SELECT
        upserted.id,
        upserted.org_id,
        upserted.user_id,
        u.email,
        u.full_name,
        CASE WHEN o.owner_user_id = upserted.user_id THEN 'admin' ELSE 'member' END::text AS role,
        upserted.is_active,
        upserted.created_at,
        upserted.last_active_at
      FROM upserted
      JOIN organizations o ON o.id = upserted.org_id
      JOIN users u ON u.id = upserted.user_id`, [
            member.orgId,
            member.userId,
            member.isActive,
            member.invitedBy,
            member.invitedAt,
            member.joinedMethod,
            member.lastActiveAt,
        ]);
        const row = result.rows[0];
        if (!row) {
            throw new NotFoundError("Member");
        }
        return this.mapMember(row);
    }
    async removeMember(orgId, userId, deactivatedBy, reason) {
        const result = await this.db.query(`UPDATE organization_members
       SET is_active = FALSE,
           deactivated_at = NOW(),
           deactivated_by = $1,
           deactivation_reason = $2,
           updated_at = NOW()
       WHERE org_id = $3 AND user_id = $4 AND is_active = TRUE`, [deactivatedBy, reason ?? null, orgId, userId]);
        if (result.rowCount === 0) {
            throw new NotFoundError("Member");
        }
    }
    async findMember(orgId, userId) {
        const result = await this.db.query(`SELECT ${MEMBER_COLUMNS}
       ${MEMBER_FROM}
       WHERE om.org_id = $1
         AND om.user_id = $2
         AND o.deleted_at IS NULL`, [orgId, userId]);
        const row = result.rows[0];
        return row ? this.mapMember(row) : null;
    }
    async findMembersByOrgId(orgId, input) {
        const [totalResult, rowsResult] = await Promise.all([
            this.db.query(`SELECT COUNT(*)::text AS total
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.org_id = $1 AND o.deleted_at IS NULL`, [orgId]),
            this.db.query(`SELECT ${MEMBER_COLUMNS}
         ${MEMBER_FROM}
         WHERE om.org_id = $1 AND o.deleted_at IS NULL
         ORDER BY om.created_at ASC
         LIMIT $2 OFFSET $3`, [orgId, input.limit, input.offset]),
        ]);
        return pagination(rowsResult.rows.map((row) => this.mapMember(row)), Number.parseInt(totalResult.rows[0]?.total ?? "0", 10), input);
    }
    async updateMemberRole(orgId, userId) {
        const result = await this.db.query(`UPDATE organization_members
       SET updated_at = NOW()
       WHERE org_id = $1 AND user_id = $2 AND is_active = TRUE`, [orgId, userId]);
        if (result.rowCount === 0) {
            throw new NotFoundError("Member");
        }
    }
    async transferOwnership(orgId, fromUserId, toUserId) {
        const client = await this.db.connect();
        try {
            await client.query("BEGIN");
            const result = await client.query(`UPDATE organizations
         SET owner_user_id = $1, updated_at = NOW()
         WHERE id = $2 AND owner_user_id = $3`, [toUserId, orgId, fromUserId]);
            if (result.rowCount === 0) {
                throw new NotFoundError("Organization");
            }
            await client.query("COMMIT");
        }
        catch (error) {
            await client.query("ROLLBACK");
            throw error;
        }
        finally {
            client.release();
        }
    }
    async createInvitation(invitation) {
        const result = await this.db.query(`WITH created AS (
        INSERT INTO organization_invitations (
          org_id,
          invited_by,
          email,
          role,
          token_hash,
          expires_at
        ) VALUES ($1, $2, LOWER($3), $4, $5, $6)
        RETURNING
          id,
          org_id,
          invited_by,
          email,
          role,
          expires_at,
          accepted_at,
          accepted_by,
          declined_at,
          revoked_at,
          revoked_by,
          resent_count,
          last_resent_at,
          created_at
      )
      SELECT
        created.id,
        created.org_id,
        created.invited_by,
        inviter.email AS invited_by_email,
        inviter.full_name AS invited_by_name,
        created.email,
        CASE WHEN created.role = 'admin' THEN 'admin' ELSE 'member' END::text AS role,
        created.expires_at,
        created.accepted_at,
        created.accepted_by,
        created.declined_at,
        created.revoked_at,
        created.revoked_by,
        created.resent_count,
        created.last_resent_at,
        created.created_at
      FROM created
      LEFT JOIN users inviter ON inviter.id = created.invited_by`, [
            invitation.orgId,
            invitation.invitedBy,
            invitation.email,
            invitation.role,
            invitation.tokenHash,
            invitation.expiresAt,
        ]);
        const row = result.rows[0];
        if (!row) {
            throw new NotFoundError("Invitation");
        }
        return this.mapInvitation(row);
    }
    async findInvitationById(id, includeSecrets = false) {
        const secretColumns = includeSecrets
            ? ", oi.email_hash, oi.token_hash"
            : "";
        const result = await this.db.query(`SELECT ${INVITATION_PUBLIC_COLUMNS}${secretColumns}
       ${INVITATION_FROM}
       WHERE oi.id = $1`, [id]);
        const row = result.rows[0];
        return row ? this.mapInvitation(row) : null;
    }
    async findInvitationByTokenHash(tokenHash) {
        const result = await this.db.query(`SELECT ${INVITATION_PUBLIC_COLUMNS}, oi.email_hash, oi.token_hash
       ${INVITATION_FROM}
       WHERE oi.token_hash = $1
         AND oi.accepted_at IS NULL
         AND oi.declined_at IS NULL
         AND oi.revoked_at IS NULL
         AND oi.expires_at > NOW()`, [tokenHash]);
        const row = result.rows[0];
        return row ? this.mapInvitation(row) : null;
    }
    async findInvitationsByOrgId(orgId, input, status) {
        const statusWhere = this.invitationStatusWhere(status);
        const params = [orgId];
        const [totalResult, rowsResult] = await Promise.all([
            this.db.query(`SELECT COUNT(*)::text AS total
         FROM organization_invitations oi
         WHERE oi.org_id = $1 ${statusWhere}`, params),
            this.db.query(`SELECT ${INVITATION_PUBLIC_COLUMNS}
         ${INVITATION_FROM}
         WHERE oi.org_id = $1 ${statusWhere}
         ORDER BY oi.created_at DESC
         LIMIT $2 OFFSET $3`, [orgId, input.limit, input.offset]),
        ]);
        return pagination(rowsResult.rows.map((row) => this.mapInvitation(row)), Number.parseInt(totalResult.rows[0]?.total ?? "0", 10), input);
    }
    async acceptInvitation(tokenHash, acceptedBy) {
        const result = await this.db.query(`UPDATE organization_invitations
       SET accepted_at = NOW(), accepted_by = $1
       WHERE token_hash = $2
         AND accepted_at IS NULL
         AND declined_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > NOW()`, [acceptedBy, tokenHash]);
        if (result.rowCount === 0) {
            throw new NotFoundError("Invitation");
        }
    }
    async declineInvitation(id) {
        const result = await this.db.query(`UPDATE organization_invitations
       SET declined_at = NOW()
       WHERE id = $1
         AND accepted_at IS NULL
         AND declined_at IS NULL
         AND revoked_at IS NULL`, [id]);
        if (result.rowCount === 0) {
            throw new NotFoundError("Invitation");
        }
    }
    async revokeInvitation(id, revokedBy) {
        const result = await this.db.query(`UPDATE organization_invitations
       SET revoked_at = NOW(), revoked_by = $1
       WHERE id = $2
         AND accepted_at IS NULL
         AND revoked_at IS NULL`, [revokedBy, id]);
        if (result.rowCount === 0) {
            throw new NotFoundError("Invitation");
        }
    }
    async incrementResentCount(id) {
        await this.db.query(`UPDATE organization_invitations
       SET resent_count = resent_count + 1, last_resent_at = NOW()
       WHERE id = $1`, [id]);
    }
    async createAuditLog(entry) {
        await this.db.query(`INSERT INTO audit_logs (
        org_id,
        user_id,
        action,
        resource_type,
        resource_id,
        metadata,
        ip_address,
        user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [
            entry.orgId,
            entry.userId,
            entry.action,
            entry.resourceType,
            entry.resourceId,
            entry.metadata ? JSON.stringify(entry.metadata) : null,
            entry.ipAddress || "0.0.0.0",
            entry.userAgent,
        ]);
    }
    async findAuditLogs(orgId, input) {
        const [totalResult, rowsResult] = await Promise.all([
            this.db.query(`SELECT COUNT(*)::text AS total
         FROM audit_logs
         WHERE org_id = $1`, [orgId]),
            this.db.query(`SELECT
           id,
           org_id,
           user_id,
           action,
           resource_type,
           resource_id,
           metadata,
           ip_address::text AS ip_address,
           user_agent,
           created_at
         FROM audit_logs
         WHERE org_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`, [orgId, input.limit, input.offset]),
        ]);
        return pagination(rowsResult.rows.map((row) => this.mapAuditLog(row)), Number.parseInt(totalResult.rows[0]?.total ?? "0", 10), input);
    }
    invitationStatusWhere(status) {
        if (status === "pending") {
            return "AND oi.accepted_at IS NULL AND oi.declined_at IS NULL AND oi.revoked_at IS NULL";
        }
        if (status === "accepted") {
            return "AND oi.accepted_at IS NOT NULL";
        }
        if (status === "declined") {
            return "AND oi.declined_at IS NOT NULL";
        }
        if (status === "revoked") {
            return "AND oi.revoked_at IS NOT NULL";
        }
        return "";
    }
    mapOrganization(row) {
        const billingContact = parseBillingContact(row.invoice_notes);
        return {
            id: row.id,
            name: row.name,
            slug: row.slug,
            description: row.description,
            logoUrl: row.logo_url,
            websiteUrl: row.website_url,
            ownerUserId: row.owner_user_id,
            status: row.org_status,
            billingStatus: row.billing_status,
            billingEmail: billingContact.billingEmail,
            billingName: billingContact.billingName,
            billingAddress: billingContact.billingAddress,
            planId: row.plan_id,
            planStartedAt: row.current_period_start,
            planExpiresAt: row.current_period_end,
            trialEndsAt: row.trial_ends_at,
            gracePeriodEndsAt: row.grace_period_end,
            enforceSso: row.enforce_sso ?? false,
            enforceMfa: row.enforce_mfa ?? false,
            allowedEmailDomains: row.allowed_email_domains,
            ipAllowlist: row.ip_allowlist,
            sessionTimeoutMinutes: row.session_timeout_minutes ?? 480,
            dataRegion: row.data_region ?? "us-east-1",
            dataRetentionDays: row.data_retention_days ?? 90,
            deletedAt: row.deleted_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
    mapMember(row) {
        return {
            id: row.id,
            orgId: row.org_id,
            userId: row.user_id,
            email: row.email,
            fullName: row.full_name,
            role: row.role,
            isActive: row.is_active,
            createdAt: row.created_at,
            lastActiveAt: row.last_active_at,
        };
    }
    mapInvitation(row) {
        const invitation = {
            id: row.id,
            orgId: row.org_id,
            invitedBy: row.invited_by,
            invitedByEmail: row.invited_by_email,
            invitedByName: row.invited_by_name,
            email: row.email,
            role: row.role,
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
        if (row.email_hash !== undefined) {
            invitation.emailHash = row.email_hash;
        }
        if (row.token_hash !== undefined) {
            invitation.tokenHash = row.token_hash;
        }
        return invitation;
    }
    mapAuditLog(row) {
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
//# sourceMappingURL=repository.js.map