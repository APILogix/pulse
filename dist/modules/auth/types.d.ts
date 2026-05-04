/**
 * Domain types for Auth Module
 * Pure types - no class instantiation overhead
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
export declare const OrgRole: z.ZodEnum<{
    owner: "owner";
    admin: "admin";
    member: "member";
    viewer: "viewer";
    billing: "billing";
}>;
export type OrgRole = z.infer<typeof OrgRole>;
export interface User {
    id: string;
    clerk_user_id: string;
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
    mfa_enabled: boolean;
    mfa_enforced_at: Date | null;
    mfa_backup_codes_generated_at: Date | null;
    login_attempts: number;
    locked_until: Date | null;
    last_login_at: Date | null;
    last_login_ip: string | null;
    last_login_user_agent: string | null;
    timezone: string;
    locale: string;
    preferred_mfa_method: MFAType | null;
    accepted_terms_at: Date | null;
    accepted_privacy_at: Date | null;
    marketing_consent: boolean;
    marketing_consent_updated_at: Date | null;
    data_processing_consent: boolean;
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
    avatar_url: z.ZodOptional<z.ZodString>;
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
    password: z.ZodString;
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
export declare const MFASetupSchema: z.ZodObject<{
    type: z.ZodEnum<{
        totp: "totp";
        sms: "sms";
        email: "email";
    }>;
    device_name: z.ZodString;
    phone_number: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
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
export declare const BackupCodeSchema: z.ZodObject<{
    code: z.ZodString;
}, z.core.$strip>;
export type BackupCodeInput = z.infer<typeof BackupCodeSchema>;
export declare const BackupCodeVerificationSchema: z.ZodObject<{
    user_id: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
export type BackupCodeVerificationInput = z.infer<typeof BackupCodeVerificationSchema>;
export declare const EmptyBodySchema: z.ZodUndefined;
export declare const ClerkWebhookSchema: z.ZodObject<{
    type: z.ZodEnum<{
        "user.created": "user.created";
        "user.updated": "user.updated";
        "user.deleted": "user.deleted";
        "session.created": "session.created";
        "session.ended": "session.ended";
    }>;
    data: z.ZodObject<{
        id: z.ZodString;
        email_addresses: z.ZodOptional<z.ZodArray<z.ZodObject<{
            email_address: z.ZodString;
            verification: z.ZodOptional<z.ZodObject<{
                status: z.ZodString;
            }, z.core.$strip>>;
        }, z.core.$strip>>>;
        first_name: z.ZodOptional<z.ZodString>;
        last_name: z.ZodOptional<z.ZodString>;
        image_url: z.ZodOptional<z.ZodString>;
        deleted: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    timestamp: z.ZodNumber;
}, z.core.$strip>;
export type ClerkWebhookPayload = z.infer<typeof ClerkWebhookSchema>;
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
    readonly MFA_REQUIRED: "MFA_REQUIRED";
    readonly MFA_INVALID: "MFA_INVALID";
    readonly MFA_ALREADY_ENABLED: "MFA_ALREADY_ENABLED";
    readonly MFA_NOT_ENABLED: "MFA_NOT_ENABLED";
    readonly MFA_CHALLENGE_EXPIRED: "MFA_CHALLENGE_EXPIRED";
    readonly SESSION_INVALID: "SESSION_INVALID";
    readonly SESSION_EXPIRED: "SESSION_EXPIRED";
    readonly PASSWORD_REQUIRED: "PASSWORD_REQUIRED";
    readonly PASSWORD_INCORRECT: "PASSWORD_INCORRECT";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly WEBHOOK_INVALID: "WEBHOOK_INVALID";
    readonly INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS";
    readonly EMAIL_VERIFICATION_INVALID: "EMAIL_VERIFICATION_INVALID";
};
//# sourceMappingURL=types.d.ts.map