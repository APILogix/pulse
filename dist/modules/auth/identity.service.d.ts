import { getPasswordPolicy } from './policy.service.js';
import { type AccountDeletionConfirmInput, type AccountDeletionRequestInput, type AccountUnlockConfirmInput, type AccountUnlockRequestInput, type AdminAuditLogsQueryInput, type AuditLogEntryPublic, type MfaRecoveryRequestInput, type SsoDiscoveryQueryInput, type SsoDiscoveryResult, type UserDataExport } from './types.js';
export declare function requestAccountUnlock(input: AccountUnlockRequestInput, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
export declare function confirmAccountUnlock(input: AccountUnlockConfirmInput, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
export declare function requestAccountDeletion(userId: string, input: AccountDeletionRequestInput, ipAddress: string, requestId: string): Promise<{
    message: string;
    scheduled_at: string;
}>;
export declare function confirmAccountDeletion(input: AccountDeletionConfirmInput, ipAddress: string, requestId: string): Promise<{
    message: string;
    scheduled_at: string;
}>;
export declare function exportUserData(userId: string): Promise<UserDataExport>;
export declare function discoverSso(input: SsoDiscoveryQueryInput): Promise<SsoDiscoveryResult>;
export declare function getEmailVerificationStatus(userId: string): Promise<{
    email_verified: boolean;
    email_verified_at: Date | null;
}>;
export declare function requestMfaRecovery(userId: string, input: MfaRecoveryRequestInput, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
export declare function listUserAuditEvents(targetUserId: string, adminId: string, isAdmin: boolean, query: AdminAuditLogsQueryInput, ipAddress: string, requestId: string): Promise<{
    events: AuditLogEntryPublic[];
    total: number;
}>;
export { getPasswordPolicy };
/**
 * Soft-delete accounts whose grace period has elapsed. Invoked by the auth
 * cleanup worker.
 */
export declare function processDueAccountDeletions(): Promise<number>;
//# sourceMappingURL=identity.service.d.ts.map