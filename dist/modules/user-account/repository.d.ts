export interface UserAccountRow {
    id: string;
    display_name: string | null;
    full_name: string | null;
    email: string;
    email_verified: boolean;
    email_verified_at: Date | null;
    avatar_url: string | null;
    timezone: string;
    locale: string;
    marketing_emails: boolean | null;
    product_updates: boolean | null;
    mfa_enabled: boolean;
}
export interface MfaSummaryRow {
    method: string;
    name: string | null;
    verified: boolean;
    is_default: boolean;
}
export interface SecurityActivityRow {
    event_type: string;
    description: string | null;
    location: string | null;
    ip_address: string | null;
    created_at: Date;
}
export declare function getUserAccount(userId: string): Promise<UserAccountRow | null>;
export declare function getUserPasswordHash(userId: string): Promise<string | null>;
export declare function getVerifiedMfaDevices(userId: string): Promise<MfaSummaryRow[]>;
export declare function countBackupCodes(userId: string): Promise<number>;
export declare function countActiveSessions(userId: string): Promise<number>;
export declare function countTrustedDevices(userId: string): Promise<number>;
export declare function countPasskeys(userId: string): Promise<number>;
export interface AccountSecurityCounts {
    backupCodesRemaining: number;
    activeSessions: number;
    trustedDevices: number;
    passkeys: number;
}
/**
 * Consolidates security overview counts into a single database query to prevent
 * connection pool exhaustion spikes on account settings views (USR-Q021).
 */
export declare function getAccountSecurityCounts(userId: string): Promise<AccountSecurityCounts>;
export declare function getRecentActivity(userId: string): Promise<SecurityActivityRow[]>;
export declare function updateUserProfile(userId: string, data: {
    display_name: string;
    full_name: string | null;
    avatar_url: string | null;
    timezone: string;
    locale: string;
    marketing_emails: boolean;
    product_updates: boolean;
}): Promise<UserAccountRow | null>;
export declare function removeAvatar(userId: string): Promise<UserAccountRow | null>;
export declare function scheduleAccountDeletion(userId: string): Promise<{
    deleted_at: Date;
} | null>;
export declare function cancelAccountDeletion(userId: string): Promise<boolean>;
export declare function revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number>;
export declare function getUserDataExport(userId: string): Promise<Record<string, unknown>>;
//# sourceMappingURL=repository.d.ts.map