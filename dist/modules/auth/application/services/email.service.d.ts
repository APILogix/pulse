import { type ChangePasswordInput, type ForgotPasswordInput, type ResendVerificationInput, type ResetPasswordInput, type User, type VerifyEmailInput } from '../../domain/types.js';
export declare function getBaseUrl(value: string | undefined, fallback: string): string;
export declare function buildVerifyEmailUrl(token: string): string;
export declare function buildResetPasswordUrl(token: string): string;
export declare function buildMfaDisableConfirmUrl(token: string): string;
export declare function toMinutes(seconds: number): number;
export declare function sendVerificationEmail(user: Pick<User, 'email' | 'full_name'>, token: string): Promise<void>;
export declare function sendPasswordResetEmail(user: Pick<User, 'email' | 'full_name'>, token: string): Promise<void>;
export declare function sendMFAStatusEmail(user: Pick<User, 'email' | 'full_name'>, enabled: boolean): Promise<void>;
export declare function sendMfaDisableConfirmEmail(user: Pick<User, 'email' | 'full_name'>, token: string): Promise<void>;
/**
 * Generate a cryptographically random 6-digit numeric OTP.
 * Uses rejection sampling to avoid modulo bias.
 */
export declare function generateEmailMfaOtp(): Promise<string>;
export declare function hashEmailMfaOtp(code: string): string;
/**
 * Persist an email MFA OTP. Any prior unconsumed OTP for the same device is
 * invalidated first so only the newest code is valid.
 */
export declare function createEmailMfaOtp(userId: string, deviceId: string, codeHash: string): Promise<void>;
/**
 * Atomically consume an email MFA OTP. Returns true if the code matched and
 * was not yet used/expired.
 */
export declare function consumeEmailMfaOtp(deviceId: string, codeHash: string): Promise<boolean>;
export declare function sendEmailMfaOtpEmail(user: Pick<User, 'email' | 'full_name'>, code: string, deviceName: string, purpose: 'setup' | 'login' | 'challenge'): Promise<void>;
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
//# sourceMappingURL=email.service.d.ts.map