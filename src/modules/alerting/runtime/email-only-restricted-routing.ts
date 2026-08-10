import type { Pool } from 'pg';
import { pool } from '../../../config/database.js';
import type { NotificationProvider, NotificationRecipientType } from './notification-entitlement.service.js';

export type RestrictedRoutingReason = 'EMAIL_ONLY_RESTRICTED' | 'OWNER_EMAIL_UNAVAILABLE';

export interface ProjectOwnerIdentity {
  userId: string;
  email: string;
}

export interface ProjectOwnerReader {
  findActiveVerifiedOwner(organizationId: string, projectId: string): Promise<ProjectOwnerIdentity | null>;
}

export interface RestrictedEmailTarget {
  channelKind: 'email';
  channelId: null;
  connectorId: null;
  recipientUserId: string;
  recipientRef: string;
  routeId: null;
  deliveryMode: 'EMAIL_ONLY_RESTRICTED';
  recipientType: Extract<NotificationRecipientType, 'PROJECT_OWNER'>;
  provider: Extract<NotificationProvider, 'MANAGED_EMAIL'>;
}

export interface RestrictedRoutingResult {
  target: RestrictedEmailTarget | null;
  reason: RestrictedRoutingReason;
}

export class ProjectOwnerRepository implements ProjectOwnerReader {
  constructor(private readonly db: Pool = pool) {}

  async findActiveVerifiedOwner(
    organizationId: string,
    projectId: string,
  ): Promise<ProjectOwnerIdentity | null> {
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
}

export class EmailOnlyRestrictedRouting {
  constructor(private readonly owners: ProjectOwnerReader = new ProjectOwnerRepository()) {}

  async resolve(organizationId: string, projectId: string): Promise<RestrictedRoutingResult> {
    const owner = await this.owners.findActiveVerifiedOwner(organizationId, projectId);
    if (!owner) return { target: null, reason: 'OWNER_EMAIL_UNAVAILABLE' };

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
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
