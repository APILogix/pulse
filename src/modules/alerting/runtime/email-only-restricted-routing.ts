import type { Pool } from 'pg';
import type { NotificationProvider, NotificationRecipientType } from './notification-entitlement.service.js';

export type RestrictedRoutingReason = 'EMAIL_ONLY_RESTRICTED' | 'OWNER_EMAIL_UNAVAILABLE';

export interface ProjectOwnerIdentity {
  userId: string;
  email: string;
}

export interface ProjectOwnerReader {
  findActiveVerifiedOwner(organizationId: string, projectId: string): Promise<ProjectOwnerIdentity | null>;
  findActiveVerifiedFallbackRecipient?(organizationId: string, projectId?: string | null): Promise<ProjectOwnerIdentity | null>;
}

export interface RestrictedEmailTarget {
  channelKind: 'email';
  channelId: null;
  connectorId: null;
  recipientUserId: string;
  recipientRef: string;
  routeId: null;
  deliveryMode: 'EMAIL_ONLY_RESTRICTED';
  recipientType: Extract<NotificationRecipientType, 'PROJECT_OWNER' | 'ORGANIZATION_FALLBACK'>;
  provider: Extract<NotificationProvider, 'MANAGED_EMAIL'>;
}

export interface RestrictedRoutingResult {
  target: RestrictedEmailTarget | null;
  reason: RestrictedRoutingReason;
}

export class ProjectOwnerRepository implements ProjectOwnerReader {
  constructor(private readonly db?: Pool) {}


  async findActiveVerifiedOwner(
    organizationId: string,
    projectId: string,
  ): Promise<ProjectOwnerIdentity | null> {
    if (!this.db) return null;
    const result = await this.db.query<{ user_id: string; email: string }>(
      `SELECT member.user_id, LOWER(BTRIM(user_account.email)) AS email
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
        LIMIT 1`,
      [organizationId, projectId],
    );
    const row = result.rows[0];
    return row ? { userId: row.user_id, email: row.email } : null;
  }

  async findActiveVerifiedFallbackRecipient(
    organizationId: string,
    _projectId?: string | null,
  ): Promise<ProjectOwnerIdentity | null> {
    if (!this.db) return null;
    const result = await this.db.query<{ user_id: string; email: string }>(
      `SELECT organization_member.user_id, LOWER(BTRIM(user_account.email)) AS email
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
        LIMIT 1`,
      [organizationId],
    );
    const row = result.rows[0];
    return row ? { userId: row.user_id, email: row.email } : null;
  }
}

export class EmailOnlyRestrictedRouting {
  constructor(private readonly owners: ProjectOwnerReader = new ProjectOwnerRepository()) {}

  async resolve(organizationId: string, projectId: string): Promise<RestrictedRoutingResult> {
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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
