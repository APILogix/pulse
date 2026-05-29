import { type BackupCodeLoginInput, type ChangePasswordInput, type CreateUserInput, type DeleteUserInput, type EmailMFASetup, type ForgotPasswordInput, type ListUsersQueryInput, type LoginInput, type LoginMFAVerifyInput, type MFAChallenge, type MFADevice, type MFADisableConfirmInput, type MFADisableRequestInput, type MFASetupInput, type MFAToggleInput, type MFAVerifyInput, type MFAVerifySetupInput, type RegenerateBackupCodesInput, type ResendVerificationInput, type ResetPasswordInput, type SessionInfo, type TOTPSetup, type UpdateUserInput, type UserProfile, type VerifyEmailQueryInput } from './types.js';
/**
 * Register a user. To prevent email-existence enumeration, the route always
 * returns a generic 201 message regardless of whether the email is already
 * taken. When the email IS already taken we silently no-op (no second user
 * created) and emit an audit-only event so security teams can detect probes.
 */
export declare function createUserFromEmail(input: CreateUserInput, ipAddress: string, requestId: string): Promise<void>;
export declare function getCurrentUser(userId: string): Promise<UserProfile>;
export declare function updateCurrentUser(userId: string, input: UpdateUserInput): Promise<UserProfile>;
export declare function deleteCurrentUser(userId: string, input: DeleteUserInput, ipAddress: string, requestId: string): Promise<void>;
export declare function getUserById(targetUserId: string, requesterId: string, isAdmin: boolean): Promise<UserProfile>;
export declare function listAllUsers(options: ListUsersQueryInput, isAdmin: boolean): Promise<{
    users: UserProfile[];
    total: number;
}>;
export declare function restoreDeletedUser(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function suspendUser(targetUserId: string, reason: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function loginWithEmailPassword(input: LoginInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    mfa_required: true;
    challenge_id: string;
    expires_at: Date;
    device_type: string;
    user_id: string;
} | {
    mfa_required: false;
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function verifyLoginMFAChallenge(input: LoginMFAVerifyInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function verifyLoginBackupCode(input: BackupCodeLoginInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function resendVerification(input: ResendVerificationInput, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
export declare function verifyEmail(input: VerifyEmailQueryInput, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
export declare function requestPasswordReset(input: ForgotPasswordInput, ipAddress: string, requestId: string): Promise<{
    message: string;
}>;
export declare function resetPasswordWithToken(input: ResetPasswordInput, ipAddress: string, requestId: string): Promise<void>;
/**
 * Change password from inside an authenticated session.
 *
 * Requirements:
 *   - Caller must currently have a fresh step-up MFA challenge if MFA is on
 *     (enforced at the route level via `requireStepUp`). This function still
 *     defends the requirement by checking `mfaVerified` for users who have
 *     mfa_enabled.
 *   - Caller must supply the current password.
 *   - New password must not match any of the last 5 hashes.
 *
 * Side effects:
 *   - Every OTHER session is revoked.
 *   - All access tokens for OTHER sessions are blacklisted.
 *   - The caller's current session is revoked and replaced with a fresh one
 *     so they remain signed in on the device they just verified themselves on.
 */
export declare function changePassword(userId: string, currentSessionId: string, input: ChangePasswordInput, mfaVerified: boolean, ipAddress: string, userAgent: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
}>;
export declare function setupMFA(userId: string, input: MFASetupInput, ipAddress: string): Promise<(TOTPSetup | EmailMFASetup) & {
    device_id: string;
    device_type: string;
}>;
export declare function verifyMFASetup(userId: string, input: MFAVerifySetupInput, ipAddress: string, requestId: string): Promise<void>;
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
export declare function listUserSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]>;
export declare function revokeSession(userId: string, sessionId: string, currentSessionId?: string): Promise<void>;
/**
 * Revoke every session except the caller's. Surgically blacklists the
 * access tokens of OTHER sessions only — the caller's current access token
 * remains valid until it expires naturally.
 */
export declare function revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number>;
/**
 * Refresh-token rotation with reuse detection AND a 30-second retry-grace
 * window. The grace window is what protects legitimate clients on flaky
 * networks from being kicked out: when the same refresh token is presented
 * twice within the window, the second call is treated as a network retry,
 * not a replay attack.
 */
export declare function refreshAccessToken(refreshToken: string, ipAddress: string, userAgent: string, requestId: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    sessionId: string;
}>;
export declare function logout(userId: string, sessionId: string, ipAddress: string, requestId: string): Promise<void>;
//# sourceMappingURL=service.d.ts.map