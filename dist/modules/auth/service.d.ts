/**
 * Auth Service - Business Logic
 * Enterprise-grade security with rate limiting, encryption, and audit logging
 */
import type { User, UserProfile, MFADevice, TOTPSetup, MFAChallenge, SessionInfo, CreateUserInput, UpdateUserInput, DeleteUserInput, MFASetupInput, MFAVerifySetupInput, MFAVerifyInput, BackupCodeVerificationInput, LoginInput, LoginMFAVerifyInput, ChangePasswordInput, ForgotPasswordInput, ResetPasswordInput } from "./types.js";
export declare function createUserFromEmail(input: CreateUserInput, ipAddress: string, requestId: string): Promise<User>;
export declare function getCurrentUser(userId: string): Promise<UserProfile>;
export declare function updateCurrentUser(userId: string, input: UpdateUserInput): Promise<UserProfile>;
export declare function deleteCurrentUser(userId: string, input: DeleteUserInput, ipAddress: string, requestId: string): Promise<void>;
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
    token_type: "Bearer";
    session_id: string;
}>;
export declare function verifyLoginMFAChallenge(input: LoginMFAVerifyInput, ipAddress: string, userAgent: string, clientDeviceType: string, requestId: string): Promise<{
    access_token: string;
    refresh_token: string;
    expires_at: Date;
    token_type: "Bearer";
    session_id: string;
    user_id: string;
}>;
export declare function requestPasswordReset(input: ForgotPasswordInput, ipAddress: string, requestId: string): Promise<{
    message: string;
    resetToken?: string;
}>;
export declare function resetPasswordWithToken(input: ResetPasswordInput, ipAddress: string, requestId: string): Promise<void>;
export declare function changePassword(userId: string, input: ChangePasswordInput, mfaVerified: boolean, ipAddress: string, requestId: string): Promise<void>;
export declare function verifyBackupCode(userId: string, input: BackupCodeVerificationInput): Promise<boolean>;
export declare function getUserById(targetUserId: string, requesterId: string, isAdmin: boolean): Promise<UserProfile>;
export declare function listAllUsers(options: {
    status?: import("./types.js").UserStatus;
    limit?: number;
    offset?: number;
    search?: string;
}, isAdmin: boolean): Promise<{
    users: UserProfile[];
    total: number;
}>;
export declare function restoreDeletedUser(targetUserId: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function suspendUser(targetUserId: string, reason: string, adminId: string, isAdmin: boolean, ipAddress: string, requestId: string): Promise<UserProfile>;
export declare function setupMFA(userId: string, input: MFASetupInput, ipAddress: string): Promise<TOTPSetup>;
export declare function verifyMFASetup(userId: string, input: MFAVerifySetupInput): Promise<void>;
export declare function createMFAChallenge(userId: string): Promise<MFAChallenge>;
export declare function verifyMFAChallenge(challengeId: string, input: MFAVerifyInput): Promise<{
    userId: string;
    deviceId: string;
}>;
export declare function listMFADevices(userId: string): Promise<MFADevice[]>;
export declare function setPrimaryMFADevice(userId: string, deviceId: string): Promise<void>;
export declare function removeMFADevice(userId: string, deviceId: string, mfaCode?: string, ipAddress?: string, requestId?: string): Promise<void>;
export declare function generateNewBackupCodes(userId: string, mfaCode: string): Promise<string[]>;
export declare function disableMFA(userId: string, mfaCode: string, ipAddress: string, requestId?: string): Promise<void>;
export declare function listUserSessions(userId: string, currentSessionId?: string): Promise<SessionInfo[]>;
export declare function revokeSession(userId: string, sessionId: string, currentSessionId?: string): Promise<void>;
export declare function revokeAllOtherSessions(userId: string, currentSessionId: string): Promise<number>;
export declare function refreshAccessToken(refreshToken: string, ipAddress: string, userAgent: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt: Date;
}>;
export declare function logout(sessionId: string): Promise<void>;
export declare function handleClerkWebhook(payload: unknown, signature: string, secret: string): Promise<void>;
//# sourceMappingURL=service.d.ts.map