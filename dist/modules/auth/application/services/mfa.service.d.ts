import { type EmailMFASetup, type MFAChallenge, type MFADevice, type MFADisableConfirmInput, type MFADisableRequestInput, type MFASetupInput, type MFAToggleInput, type MFAVerifyInput, type MFAVerifySetupInput, type RegenerateBackupCodesInput, type TOTPSetup } from '../../domain/types.js';
export declare function setupMFA(userId: string, input: MFASetupInput, ipAddress: string): Promise<(TOTPSetup | EmailMFASetup) & {
    device_id: string;
    device_type: string;
}>;
export declare function verifyMFASetup(userId: string, input: MFAVerifySetupInput, ipAddress: string, requestId: string): Promise<{
    backup_codes: string[];
}>;
export declare function createMFAChallenge(userId: string): Promise<MFAChallenge>;
/**
 * Verify a step-up MFA challenge. On success, stamp step-up freshness on the
 * caller's session in the LRU. Sensitive routes (`requireStepUp`) check that
 * stamp.
 */
export declare function verifyMFAChallenge(challengeId: string, input: MFAVerifyInput, sessionId: string, ipAddress: string): Promise<{
    userId: string;
    deviceId: string;
}>;
export declare function listMFADevices(userId: string): Promise<MFADevice[]>;
export declare function renameMFADevice(userId: string, deviceId: string, input: {
    device_name: string;
}): Promise<void>;
/**
 * Admin-initiated password reset email. Revokes all active sessions first.
 */
export declare function adminForcePasswordReset(targetUserId: string, adminId: string, isAdmin: boolean, input: {
    reason?: string;
}, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
/**
 * Resend an email MFA OTP for a given device. Used during setup (to resend
 * the setup confirmation code) and during step-up challenges.
 */
export declare function resendEmailMfaOtp(userId: string, deviceId: string): Promise<void>;
export declare function setPrimaryMFADevice(userId: string, deviceId: string): Promise<void>;
/**
 * Remove an MFA device.
 *
 * If this is the LAST verified+active device, we require the current
 * password AND step-up freshness on the session (`routes.ts` enforces step-up
 * via the route middleware). We never accept a TOTP from the device being
 * removed.
 *
 * If other devices remain, step-up freshness is still required by the route
 * but no password is needed; the user has already proven recent MFA via the
 * step-up challenge.
 */
export declare function removeMFADevice(userId: string, deviceId: string, currentPassword: string | undefined, ipAddress: string, requestId: string): Promise<void>;
export declare function generateNewBackupCodes(userId: string, input: RegenerateBackupCodesInput): Promise<string[]>;
/**
 * Toggle MFA. Enabling requires possession of an already-verified device +
 * a fresh TOTP code. Disabling now goes through the two-step
 * `requestMfaDisable` / `confirmMfaDisable` flow and is rejected here.
 */
export declare function toggleMFA(userId: string, input: MFAToggleInput, ipAddress: string, requestId: string): Promise<{
    enabled: boolean;
}>;
/**
 * Step 1 of MFA disable: verify the supplied TOTP, then mail the user a
 * one-time confirmation link. MFA stays enabled until the link is consumed.
 *
 * This prevents the "phished password + one TOTP = MFA disabled" attack:
 * even if both are phished in real time, the attacker still needs control
 * of the user's email inbox.
 */
export declare function requestMfaDisable(userId: string, input: MFADisableRequestInput, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
/**
 * Step 2 of MFA disable: consume the one-time email token and actually
 * disable MFA. The token can only be redeemed once; old tokens for the same
 * user/purpose are invalidated when a new request is made.
 */
export declare function confirmMfaDisable(input: MFADisableConfirmInput, ipAddress: string, requestId: string): Promise<void>;
/**
 * Single-step MFA disable. The route requires fresh step-up, so this function
 * only checks account/device state and performs the teardown transaction.
 */
export declare function disableMFA(userId: string, _input: MFADisableRequestInput, ipAddress: string, requestId: string): Promise<{
    mfa_enabled: false;
}>;
//# sourceMappingURL=mfa.service.d.ts.map