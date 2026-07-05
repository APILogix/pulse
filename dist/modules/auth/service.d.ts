import { type BackupCodeLoginInput, type ChangePasswordInput, type CreateUserInput, type DeleteUserInput, type EmailMFASetup, type ForgotPasswordInput, type ListUsersQueryInput, type LoginInput, type LoginMFAVerifyInput, type MFAChallenge, type MFADevice, type MFADisableConfirmInput, type MFADisableRequestInput, type MFASetupInput, type MFAToggleInput, type MFAVerifyInput, type MFAVerifySetupInput, type RegenerateBackupCodesInput, type ResendVerificationInput, type ResetPasswordInput, type SessionInfo, type TOTPSetup, type AdminLockUserInput, type UpdateUserInput, type User, type UserProfile, type UserSecuritySummary, type VerifyEmailInput } from './types.js';
export interface IssuedSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
    sessionId: string;
}
/**
 * Single-INSERT session creation. We pre-allocate the session UUID and sign
 * both JWTs with it before writing any row, so there is no placeholder hash
 * window. The refresh JWT is hashed and persisted in the same INSERT.
 */
export interface SessionSsoContext {
    providerId?: string;
    providerType?: string;
    loginMethod?: string;
    samlNameId?: string;
    samlSessionIndex?: string;
}
export declare function issueSessionForUser(options: {
    user: User;
    ipAddress: string;
    userAgent: string;
    deviceName: string | undefined;
    deviceType: string | undefined;
    mfaVerified: boolean;
    rememberMe?: boolean;
    ssoContext?: SessionSsoContext;
}): Promise<IssuedSession>;
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
export declare function unsuspendUser(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function adminLockUserAccount(targetUserId: string, input: AdminLockUserInput, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function adminUnlockUserAccount(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
/**
 * Revoke every active session for a target user (platform admin support).
 */
export declare function adminRevokeAllUserSessions(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<{
    revoked: number;
}>;
export declare function getUserSecuritySummary(userId: string): Promise<UserSecuritySummary>;
export declare function loginWithEmailPassword(input: LoginInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    mfa_required: true;
    challenge_id: string;
    expires_at: Date;
    device_type: string;
    available_methods?: Array<{
        id: string;
        type: string;
        name: string;
    }>;
} | {
    mfa_required: false;
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: 'Bearer';
    session_id: string;
    user_id: string;
}>;
export declare function switchLoginMfaMethod(challengeId: string, deviceId: string): Promise<{
    message: string;
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
export declare function verifyEmail(input: VerifyEmailInput, ipAddress: string, requestId: string): Promise<{
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
    currentOrgId: string | null;
}>;
export declare function logout(userId: string, sessionId: string, ipAddress: string, requestId: string): Promise<{
    saml_logout_url: string | null;
}>;
export declare function getUserSessionDetail(userId: string, sessionId: string, currentSessionId: string): Promise<{
    id: string;
    device_name: string;
    device_type: string;
    ip_address: string;
    ip_geo_country: string | null;
    last_active_at: Date;
    created_at: Date;
    expires_at: Date;
    login_method: string | null;
    is_current: boolean;
}>;
export declare function revokeAllSessionsForUser(userId: string, currentSessionId: string): Promise<number>;
//# sourceMappingURL=service.d.ts.map