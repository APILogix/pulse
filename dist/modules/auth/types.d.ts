/**
 * Domain types for Auth Module.
 *
 * Single source of truth for:
 *   - User and MFADevice row shapes (matched to canonical migration 008).
 *   - Public API request/response Zod schemas.
 *   - Strongly-typed error class.
 *
 * No class instantiation overhead; everything is a plain type or a Zod
 * schema that the routes layer parses on the wire.
 */
import { z } from 'zod';
export declare const UserStatus: z.ZodEnum<{
    active: "active";
    inactive: "inactive";
    suspended: "suspended";
    deleted: "deleted";
}>;
export type UserStatus = z.infer<typeof UserStatus>;
export declare const MFAType: z.ZodEnum<{
    totp: "totp";
    sms: "sms";
    email: "email";
    hardware_key: "hardware_key";
    backup_codes: "backup_codes";
}>;
export type MFAType = z.infer<typeof MFAType>;
export interface User {
    id: string;
    email: string;
    email_hash: string;
    email_verified: boolean;
    email_verified_at: Date | null;
    full_name: string;
    avatar_url: string | null;
    password_hash: string | null;
    last_password_change: Date | null;
    password_history: string[];
    status: UserStatus;
    status_reason: string | null;
    is_admin: boolean;
    mfa_enabled: boolean;
    mfa_enforced_at: Date | null;
    mfa_backup_codes_generated_at: Date | null;
    login_attempts: number;
    locked_until: Date | null;
    last_login_at: Date | null;
    last_login_ip: string | null;
    last_login_user_agent: string | null;
    last_failed_login_at: Date | null;
    last_failed_login_ip: string | null;
    timezone: string;
    locale: string;
    preferred_mfa_method: MFAType | null;
    accepted_terms_at: Date | null;
    accepted_terms_version: string | null;
    accepted_privacy_at: Date | null;
    accepted_privacy_version: string | null;
    marketing_consent: boolean;
    marketing_consent_updated_at: Date | null;
    data_processing_consent: boolean;
    suspended_at: Date | null;
    suspended_by: string | null;
    deleted_at: Date | null;
    deleted_by: string | null;
    deletion_reason: string | null;
    created_at: Date;
    updated_at: Date;
    created_by: string | null;
    version: number;
}
export interface UserProfile {
    id: string;
    email: string;
    email_verified: boolean;
    full_name: string;
    avatar_url: string | null;
    status: UserStatus;
    is_admin: boolean;
    mfa_enabled: boolean;
    timezone: string;
    locale: string;
    last_login_at: Date | null;
    created_at: Date;
}
export interface MFADevice {
    id: string;
    user_id: string;
    device_type: MFAType;
    device_name: string;
    secret_encrypted: string | null;
    verified: boolean;
    verified_at: Date | null;
    credential_id: string | null;
    public_key: string | null;
    sign_count: number;
    backup_codes_hash: string[] | null;
    device_metadata: Record<string, unknown>;
    last_used_at: Date | null;
    last_used_ip: string | null;
    is_primary: boolean;
    is_active: boolean;
    disabled_at: Date | null;
    disabled_reason: string | null;
    created_at: Date;
    updated_at: Date;
}
export interface TOTPSetup {
    secret: string;
    qrCodeUrl: string;
    backupCodes: string[];
}
export interface EmailMFASetup {
    backupCodes: string[];
}
export interface MFAChallenge {
    challengeId: string;
    deviceId: string;
    deviceType: MFAType;
    expiresAt: Date;
}
export declare const SessionStatus: z.ZodEnum<{
    active: "active";
    expired: "expired";
    revoked: "revoked";
    terminated_by_admin: "terminated_by_admin";
}>;
export type SessionStatus = z.infer<typeof SessionStatus>;
export interface UserSession {
    id: string;
    user_id: string;
    refresh_token_hash: string;
    previous_refresh_token_hash: string | null;
    previous_refresh_rotated_at: Date | null;
    access_token_jti: string | null;
    device_fingerprint: string | null;
    device_name: string | null;
    device_type: string | null;
    ip_address: string;
    ip_geo_country: string | null;
    ip_geo_city: string | null;
    user_agent: string | null;
    created_at: Date;
    last_active_at: Date;
    expires_at: Date;
    absolute_expires_at: Date;
    status: SessionStatus;
    terminated_at: Date | null;
    terminated_by: string | null;
    termination_reason: string | null;
    mfa_verified_at: Date | null;
    mfa_expires_at: Date | null;
}
export interface SessionInfo {
    id: string;
    device_name: string | null;
    device_type: string | null;
    ip_address: string;
    ip_geo_country: string | null;
    last_active_at: Date;
    created_at: Date;
    is_current: boolean;
}
export declare const StrongPasswordSchema: z.ZodString;
export declare const CreateUserSchema: z.ZodObject<{
    email: z.ZodString;
    full_name: z.ZodString;
    password: z.ZodString;
    avatar_url: z.ZodOptional<z.ZodString>;
    accept_terms: z.ZodLiteral<true>;
    accept_privacy: z.ZodLiteral<true>;
    marketing_consent: z.ZodDefault<z.ZodOptional<z.ZodBoolean>>;
    terms_version: z.ZodOptional<z.ZodString>;
    privacy_version: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export declare const LoginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
    device_name: z.ZodOptional<z.ZodString>;
    remember_me: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type LoginInput = z.infer<typeof LoginSchema>;
export declare const LoginMFAVerifySchema: z.ZodObject<{
    challenge_id: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
export type LoginMFAVerifyInput = z.infer<typeof LoginMFAVerifySchema>;
export declare const UpdateUserSchema: z.ZodObject<{
    full_name: z.ZodOptional<z.ZodString>;
    avatar_url: z.ZodOptional<z.ZodUnion<readonly [z.ZodString, z.ZodNull]>>;
    timezone: z.ZodOptional<z.ZodString>;
    locale: z.ZodOptional<z.ZodString>;
    preferred_mfa_method: z.ZodOptional<z.ZodEnum<{
        totp: "totp";
        sms: "sms";
        email: "email";
        hardware_key: "hardware_key";
        backup_codes: "backup_codes";
    }>>;
}, z.core.$strip>;
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;
export declare const DeleteUserSchema: z.ZodObject<{
    password: z.ZodOptional<z.ZodString>;
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DeleteUserInput = z.infer<typeof DeleteUserSchema>;
export declare const ChangePasswordSchema: z.ZodObject<{
    current_password: z.ZodString;
    new_password: z.ZodString;
}, z.core.$strip>;
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
export declare const ForgotPasswordSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;
export declare const ResetPasswordSchema: z.ZodObject<{
    token: z.ZodString;
    new_password: z.ZodString;
}, z.core.$strip>;
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;
export declare const ResendVerificationSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
export type ResendVerificationInput = z.infer<typeof ResendVerificationSchema>;
export declare const VerifyEmailQuerySchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export type VerifyEmailQueryInput = z.infer<typeof VerifyEmailQuerySchema>;
export declare const MFASetupSchema: z.ZodObject<{
    type: z.ZodEnum<{
        totp: "totp";
        email: "email";
    }>;
    device_name: z.ZodString;
}, z.core.$strip>;
export type MFASetupInput = z.infer<typeof MFASetupSchema>;
export declare const MFAVerifySetupSchema: z.ZodObject<{
    device_id: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
export type MFAVerifySetupInput = z.infer<typeof MFAVerifySetupSchema>;
export declare const MFAVerifySchema: z.ZodObject<{
    challenge_id: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
export type MFAVerifyInput = z.infer<typeof MFAVerifySchema>;
export declare const BackupCodeLoginSchema: z.ZodObject<{
    challenge_id: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
export type BackupCodeLoginInput = z.infer<typeof BackupCodeLoginSchema>;
export declare const MFADisableRequestSchema: z.ZodObject<{
    mfa_code: z.ZodString;
}, z.core.$strip>;
export type MFADisableRequestInput = z.infer<typeof MFADisableRequestSchema>;
export declare const MFADisableConfirmSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export type MFADisableConfirmInput = z.infer<typeof MFADisableConfirmSchema>;
export declare const MFAToggleSchema: z.ZodObject<{
    enabled: z.ZodLiteral<true>;
    mfa_code: z.ZodString;
}, z.core.$strip>;
export type MFAToggleInput = z.infer<typeof MFAToggleSchema>;
export declare const MFADeviceRemoveSchema: z.ZodObject<{
    current_password: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type MFADeviceRemoveInput = z.infer<typeof MFADeviceRemoveSchema>;
export declare const SuspendUserSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export type SuspendUserInput = z.infer<typeof SuspendUserSchema>;
export declare const ListUsersQuerySchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodEnum<{
        active: "active";
        inactive: "inactive";
        suspended: "suspended";
        deleted: "deleted";
    }>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    search: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ListUsersQueryInput = z.infer<typeof ListUsersQuerySchema>;
export declare const RegenerateBackupCodesSchema: z.ZodObject<{
    mfa_code: z.ZodString;
}, z.core.$strip>;
export type RegenerateBackupCodesInput = z.infer<typeof RegenerateBackupCodesSchema>;
export declare class AuthError extends Error {
    code: string;
    statusCode: number;
    details?: Record<string, unknown> | undefined;
    constructor(message: string, code: string, statusCode?: number, details?: Record<string, unknown> | undefined);
}
export declare const AuthErrorCodes: {
    readonly USER_NOT_FOUND: "USER_NOT_FOUND";
    readonly USER_EXISTS: "USER_EXISTS";
    readonly INVALID_CREDENTIALS: "INVALID_CREDENTIALS";
    readonly PASSWORD_EXPIRED: "PASSWORD_EXPIRED";
    readonly EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED";
    readonly PASSWORD_REUSE_NOT_ALLOWED: "PASSWORD_REUSE_NOT_ALLOWED";
    readonly PASSWORD_RESET_INVALID: "PASSWORD_RESET_INVALID";
    readonly PASSWORD_RESET_EXPIRED: "PASSWORD_RESET_EXPIRED";
    readonly USER_SUSPENDED: "USER_SUSPENDED";
    readonly USER_DELETED: "USER_DELETED";
    readonly ACCOUNT_LOCKED: "ACCOUNT_LOCKED";
    readonly MFA_REQUIRED: "MFA_REQUIRED";
    readonly MFA_INVALID: "MFA_INVALID";
    readonly MFA_ALREADY_ENABLED: "MFA_ALREADY_ENABLED";
    readonly MFA_NOT_ENABLED: "MFA_NOT_ENABLED";
    readonly MFA_CHALLENGE_EXPIRED: "MFA_CHALLENGE_EXPIRED";
    readonly MFA_DEVICE_NOT_FOUND: "MFA_DEVICE_NOT_FOUND";
    readonly MFA_DISABLE_INVALID: "MFA_DISABLE_INVALID";
    readonly STEP_UP_REQUIRED: "STEP_UP_REQUIRED";
    readonly SESSION_INVALID: "SESSION_INVALID";
    readonly SESSION_EXPIRED: "SESSION_EXPIRED";
    readonly REFRESH_TOKEN_REUSED: "REFRESH_TOKEN_REUSED";
    readonly PASSWORD_REQUIRED: "PASSWORD_REQUIRED";
    readonly PASSWORD_INCORRECT: "PASSWORD_INCORRECT";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS";
    readonly EMAIL_VERIFICATION_INVALID: "EMAIL_VERIFICATION_INVALID";
    readonly EMAIL_DELIVERY_FAILED: "EMAIL_DELIVERY_FAILED";
    readonly VALIDATION_ERROR: "VALIDATION_ERROR";
    readonly INVALID_OPERATION: "INVALID_OPERATION";
};
//# sourceMappingURL=types.d.ts.map