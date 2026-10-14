import { BaseRepository } from "./shared/base.repository.js";
import { type OrganizationRow, type OrgMemberRow } from "./types.js";
export interface OrganizationProvisioningResult {
    organization: OrganizationRow;
    subscriptionId: string;
    planId: string;
}
import type { BillingEntitlementsRow, OrganizationUsageCounts } from "./quotas/quotas.schema.js";
export type { BillingEntitlementsRow, OrganizationUsageCounts };
export declare class OrganizationRepository extends BaseRepository {
    /** Revoke SCIM tokens whose expires_at has passed but are not yet revoked. */
    revokeExpiredScimTokens(): Promise<number>;
    /** Delete successfully-sent outbox rows older than `days` (delivery is done). */
    purgeSentEmailOutbox(days: number): Promise<number>;
    /** Delete permanently-failed outbox rows older than `days` (retries exhausted). */
    purgeFailedEmailOutbox(days: number): Promise<number>;
    /**
     * organization_settings.audit_log_retention_days defines its own window;
     * non-sensitive logs older than that window are deleted. Sensitive logs
     * (is_sensitive = TRUE) are retained regardless — compliance/forensics keep
     * those even when normal operational logs roll off.
     */
    purgeExpiredAuditLogs(batchSize?: number): Promise<number>;
    /**
     * Retrieves the multi-organization context for a given user.
     * This is called during the login flow to append context to the response.
     */
    getUserContextForLogin(userId: string): Promise<{
        default_org_slug: string | null;
        organizations: Array<{
            id: string;
            slug: string;
            name: string;
            role: string;
        }>;
    }>;
    getBillingEntitlements(orgId: string): Promise<BillingEntitlementsRow | null>;
    getOrganizationUsageCounts(orgId: string): Promise<OrganizationUsageCounts>;
    /**
     * Adjust the fast-path `organization_usage_current_period.api_keys_used`
     * counter so org-level dashboards/quota checks reflect API key creation and
     * deletion immediately. Non-fatal: callers treat a missing usage row (org
     * has no active subscription period yet) as a no-op rather than an error,
     * since the authoritative limit enforcement is the live COUNT(*) in
     * `ProjectsRepository.getProjectModuleUsageCounts`.
     */
    adjustApiKeyUsageCounter(orgId: string, delta: number): Promise<void>;
    findActiveMember(orgId: string, userId: string): Promise<OrgMemberRow | null>;
    findUserByEmail(email: string): Promise<{
        id: string;
        email: string;
        full_name: string;
    } | null>;
    expireStalePendingInvitations(): Promise<number>;
    purgeTerminalInvitations(days: number): Promise<number>;
}
//# sourceMappingURL=repository.d.ts.map