import type { PoolClient } from "pg";
import { type OrganizationRow, type OrgSettingsRow, type OrgMemberRow, type OrgInvitationRow, type AuditLogRow, type OrgEnvironmentRow, type OrgApiKeyRow, type OrgSsoProviderRow, type OrgScimTokenRow, type SecurityEventRow, type QuotaRequestRow, type UserOrgRow, type CreateAuditLogRecord, type CursorPaginationQuery, type CursorPaginatedResponse, type AlertThresholdRow } from "./types.js";
export declare class OrganizationRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createOrg(name: string, ownerUserId: string, data: {
        description?: string;
        industry?: string;
        companySize?: string;
        country?: string;
        timezone?: string;
        billingEmail?: string;
    }): Promise<OrganizationRow>;
    findOrgById(id: string, includeDeleted?: boolean): Promise<OrganizationRow | null>;
    findOrgBySlug(slug: string): Promise<OrganizationRow | null>;
    updateOrg(id: string, data: Record<string, unknown>): Promise<OrganizationRow>;
    softDeleteOrg(id: string): Promise<void>;
    /** Collect every project API-key hash for an org so the service can evict the
     *  ingestion cache after delete/suspend. Returns hashes regardless of state. */
    listOrgApiKeyHashes(orgId: string): Promise<string[]>;
    archiveOrg(id: string): Promise<void>;
    restoreOrg(id: string): Promise<OrganizationRow>;
    transferOwnership(orgId: string, fromId: string, toId: string): Promise<void>;
    getSettings(orgId: string): Promise<OrgSettingsRow | null>;
    updateSettings(orgId: string, data: Record<string, unknown>): Promise<OrgSettingsRow>;
    findActiveMember(orgId: string, userId: string): Promise<OrgMemberRow | null>;
    findMember(orgId: string, userId: string): Promise<OrgMemberRow | null>;
    getMemberRole(orgId: string, userId: string): Promise<string | null>;
    listMembers(orgId: string, q: CursorPaginationQuery, filters?: {
        status?: string;
        role?: string;
    }): Promise<CursorPaginatedResponse<OrgMemberRow>>;
    addMember(orgId: string, userId: string, role: string, invitedBy: string, method: string): Promise<OrgMemberRow>;
    removeMember(orgId: string, userId: string, by: string, reason?: string): Promise<void>;
    suspendMember(orgId: string, userId: string, by: string, reason?: string): Promise<void>;
    reactivateMember(orgId: string, userId: string): Promise<void>;
    updateMemberRole(orgId: string, userId: string, role: string): Promise<void>;
    countOwners(orgId: string): Promise<number>;
    /**
     * Look up a (non-deleted) user by email for invitation flows. Returns the
     * minimal identity needed to (a) decide whether the invitee already has an
     * account and (b) personalize the invite email. Email match is
     * case-insensitive to align with how the auth module normalizes emails.
     */
    findUserByEmail(email: string): Promise<{
        id: string;
        email: string;
        full_name: string;
    } | null>;
    createAuditLog(entry: CreateAuditLogRecord): Promise<void>;
    listAuditLogs(orgId: string, q: CursorPaginationQuery, filters?: {
        action?: string;
        entityType?: string;
        actorUserId?: string;
    }): Promise<CursorPaginatedResponse<AuditLogRow>>;
    createInvitation(orgId: string, invitedBy: string, email: string, role: string, tokenHash: string, expiresAt: Date): Promise<OrgInvitationRow>;
    findInvitationById(id: string): Promise<OrgInvitationRow | null>;
    findInvitationByTokenHash(hash: string): Promise<(OrgInvitationRow & {
        email_hash?: string;
    }) | null>;
    listInvitations(orgId: string, q: CursorPaginationQuery, status?: string): Promise<CursorPaginatedResponse<OrgInvitationRow>>;
    acceptInvitation(tokenHash: string, userId: string): Promise<void>;
    declineInvitation(id: string): Promise<void>;
    revokeInvitation(id: string, by: string): Promise<void>;
    incrementResentCount(id: string): Promise<void>;
    /**
     * Replace the token hash for a pending invitation. Used by resend, since the
     * plaintext token is never stored — a resend must issue a fresh token so the
     * emailed link is valid.
     */
    rotateInvitationToken(id: string, tokenHash: string): Promise<void>;
    createEnvironment(orgId: string, name: string, desc: string | null, isProd: boolean, createdBy: string): Promise<OrgEnvironmentRow>;
    updateEnvironment(orgId: string, envId: string, data: Record<string, unknown>): Promise<OrgEnvironmentRow>;
    listEnvironments(orgId: string): Promise<OrgEnvironmentRow[]>;
    createApiKey(orgId: string, name: string, keyPrefix: string, hashedKey: string, role: string, envId: string | null, expiresAt: Date | null, createdBy: string): Promise<OrgApiKeyRow>;
    revokeApiKey(orgId: string, keyId: string): Promise<void>;
    listApiKeys(orgId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<OrgApiKeyRow>>;
    createSsoProvider(orgId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow>;
    updateSsoProvider(orgId: string, ssoId: string, data: Record<string, unknown>): Promise<OrgSsoProviderRow>;
    deleteSsoProvider(orgId: string, ssoId: string): Promise<void>;
    createScimToken(orgId: string, tokenHash: string, expiresAt: Date | null, createdBy: string): Promise<OrgScimTokenRow>;
    revokeScimToken(orgId: string, tokenId: string): Promise<void>;
    listSecurityEvents(orgId: string, q: CursorPaginationQuery, filters?: {
        severity?: string;
        eventType?: string;
    }): Promise<CursorPaginatedResponse<SecurityEventRow>>;
    createQuotaRequest(orgId: string, quotaType: string, currentLimit: number, requestedLimit: number, reason: string): Promise<QuotaRequestRow>;
    reviewQuotaRequest(orgId: string, requestId: string, status: string, reviewedBy: string, notes?: string): Promise<QuotaRequestRow>;
    listQuotaRequests(orgId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<QuotaRequestRow>>;
    listUserOrganizations(userId: string, q: CursorPaginationQuery): Promise<CursorPaginatedResponse<UserOrgRow>>;
    findInvitationByOrgAndId(orgId: string, invitationId: string): Promise<OrgInvitationRow | null>;
    rotateApiKey(orgId: string, keyId: string, newName: string, newPrefix: string, newHashedKey: string, newRole: string, envId: string | null, expiresAt: Date | null, createdBy: string): Promise<OrgApiKeyRow>;
    exportAuditLogs(orgId: string, filters?: {
        action?: string;
        entityType?: string;
        actorUserId?: string;
        startDate?: string;
        endDate?: string;
    }): Promise<AuditLogRow[]>;
    isSlugAvailable(slug: string): Promise<boolean>;
    listScimTokens(orgId: string): Promise<OrgScimTokenRow[]>;
    listSsoProviders(orgId: string): Promise<OrgSsoProviderRow[]>;
    private static readonly ALERT_THRESHOLD_COLS;
    /** Read the threshold config for an org/project scope (project null = org-wide). */
    getAlertThresholds(orgId: string, projectId: string | null): Promise<AlertThresholdRow | null>;
    /** List every threshold config for an org (org-wide row + per-project rows). */
    listAlertThresholds(orgId: string): Promise<AlertThresholdRow[]>;
    /**
     * Insert-or-update the threshold config for an org/project scope. Only the
     * provided columns are overwritten; on conflict, COALESCE keeps the existing
     * value for any column passed as NULL so partial updates are safe.
     */
    upsertAlertThresholds(orgId: string, projectId: string | null, data: Record<string, unknown>, createdBy: string): Promise<AlertThresholdRow>;
    /** Stamp last_alerted_at to enforce the cooldown window after an alert fires. */
    markAlertThresholdFired(id: string): Promise<void>;
    /** Resolve a fallback alert recipient for an org (alert/billing/support/owner email). */
    getOrgFallbackEmail(orgId: string): Promise<string | null>;
    /**
     * Transition pending invitations whose expiry has passed to 'expired'.
     * A safe, reversible state move (the row is retained for the audit/UI trail)
     * that also frees the partial-unique (org_id, email) WHERE status='pending'
     * index so a fresh invite to the same address can be issued.
     */
    expireStalePendingInvitations(): Promise<number>;
    /**
     * Permanently delete invitations that reached a terminal, non-accepted state
     * (expired / revoked / declined) longer than `days` ago. Accepted invitations
     * are retained (they record how a current member joined).
     */
    purgeTerminalInvitations(days: number): Promise<number>;
    /** Revoke org API keys whose expires_at has passed but are not yet revoked. */
    revokeExpiredApiKeys(): Promise<number>;
    /** Revoke SCIM tokens whose expires_at has passed but are not yet revoked. */
    revokeExpiredScimTokens(): Promise<number>;
    /** Delete successfully-sent outbox rows older than `days` (delivery is done). */
    purgeSentEmailOutbox(days: number): Promise<number>;
    /** Delete permanently-failed outbox rows older than `days` (retries exhausted). */
    purgeFailedEmailOutbox(days: number): Promise<number>;
    /**
     * Enforce per-org audit-log retention. Each org's
     * organization_settings.audit_log_retention_days defines its own window;
     * non-sensitive logs older than that window are deleted. Sensitive logs
     * (is_sensitive = TRUE) are retained regardless — compliance/forensics keep
     * those even when normal operational logs roll off.
     */
    purgeExpiredAuditLogs(): Promise<number>;
}
//# sourceMappingURL=repository.d.ts.map