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
    current_org_id: string | null;
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
    deletion_scheduled_at: Date | null;
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
    display_hint: string | null;
    phone_number_encrypted: string | null;
    failed_attempts: number;
    last_failed_at: Date | null;
    use_count: number;
    created_at: Date;
    updated_at: Date;
}
/**
 * Effective organization MFA policy (migration 005). Resolved across all of a
 * user's active org memberships using a "strictest wins" rule, mirroring
 * EffectiveAuthPolicy in policy.service.ts.
 */
export interface MfaPolicy {
    mfa_required: boolean;
    allowed_methods: MFAType[];
    primary_method_preference: MFAType | null;
    backup_codes_required: boolean;
    grace_period_days: number;
    max_devices_per_user: number;
    allow_sms_fallback: boolean;
    allow_email_fallback: boolean;
    remember_device_days: number;
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
    sso_provider_id: string | null;
    sso_provider_type: string | null;
    login_method: string | null;
    saml_name_id: string | null;
    saml_session_index: string | null;
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
    trust_device: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type LoginInput = z.infer<typeof LoginSchema>;
export declare const LoginResponseSchema: z.ZodObject<{
    access_token: z.ZodString;
    expires_at: z.ZodDate;
    session_id: z.ZodString;
    token_type: z.ZodLiteral<"Bearer">;
    user: z.ZodOptional<z.ZodObject<{
        id: z.ZodString;
        email: z.ZodString;
        name: z.ZodString;
    }, z.core.$strip>>;
    default_org_slug: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    organizations: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        slug: z.ZodString;
        name: z.ZodString;
        role: z.ZodString;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type LoginResponse = z.infer<typeof LoginResponseSchema>;
export declare const LoginMFAVerifySchema: z.ZodObject<{
    challenge_id: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
export type LoginMFAVerifyInput = z.infer<typeof LoginMFAVerifySchema>;
/** Backup-code login during an active server-issued MFA challenge. */
export declare const BackupCodeLoginSchema: z.ZodObject<{
    challenge_id: z.ZodString;
    code: z.ZodString;
}, z.core.$strip>;
export type BackupCodeLoginInput = z.infer<typeof BackupCodeLoginSchema>;
export declare const EmailMfaResendSchema: z.ZodObject<{
    device_id: z.ZodString;
}, z.core.$strip>;
export type EmailMfaResendInput = z.infer<typeof EmailMfaResendSchema>;
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
export declare const VerifyEmailConfirmSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export type VerifyEmailInput = z.infer<typeof VerifyEmailConfirmSchema>;
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
export declare const MFADisableRequestSchema: z.ZodObject<{
    mfa_code: z.ZodOptional<z.ZodString>;
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
export declare const AdminLockUserSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export type AdminLockUserInput = z.infer<typeof AdminLockUserSchema>;
/** Public security posture for the authenticated user (settings UI). */
export interface UserSecuritySummary {
    email_verified: boolean;
    mfa_enabled: boolean;
    active_session_count: number;
    verified_mfa_device_count: number;
    last_login_at: Date | null;
    last_password_change: Date | null;
    account_locked: boolean;
    locked_until: Date | null;
    status: UserStatus;
}
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
    readonly SSO_REQUIRED: "SSO_REQUIRED";
    readonly EMAIL_IN_USE: "EMAIL_IN_USE";
    readonly DELETION_ALREADY_SCHEDULED: "DELETION_ALREADY_SCHEDULED";
    readonly OIDC_NOT_CONFIGURED: "OIDC_NOT_CONFIGURED";
    readonly OIDC_CALLBACK_INVALID: "OIDC_CALLBACK_INVALID";
    readonly WEBAUTHN_CHALLENGE_INVALID: "WEBAUTHN_CHALLENGE_INVALID";
    readonly JIT_PROVISIONING_DISABLED: "JIT_PROVISIONING_DISABLED";
    readonly SSO_DOMAIN_MISMATCH: "SSO_DOMAIN_MISMATCH";
    readonly SSO_NOT_CONFIGURED: "SSO_NOT_CONFIGURED";
    readonly SAML_NOT_CONFIGURED: "SAML_NOT_CONFIGURED";
    readonly SAML_RESPONSE_INVALID: "SAML_RESPONSE_INVALID";
    readonly IDENTITY_PROVIDER_NOT_CONFIGURED: "IDENTITY_PROVIDER_NOT_CONFIGURED";
    readonly IDENTITY_ALREADY_LINKED: "IDENTITY_ALREADY_LINKED";
    readonly IDENTITY_LINK_FAILED: "IDENTITY_LINK_FAILED";
    readonly SOCIAL_LOGIN_FAILED: "SOCIAL_LOGIN_FAILED";
    readonly SCIM_UNAUTHORIZED: "SCIM_UNAUTHORIZED";
    readonly SCIM_NOT_FOUND: "SCIM_NOT_FOUND";
    readonly SCIM_CONFLICT: "SCIM_CONFLICT";
};
export declare const SocialLoginSchema: z.ZodObject<{
    remember_me: z.ZodOptional<z.ZodBoolean>;
    device_name: z.ZodOptional<z.ZodString>;
    device_type: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SocialLoginInput = z.infer<typeof SocialLoginSchema>;
export declare const AccountUnlockRequestSchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
export type AccountUnlockRequestInput = z.infer<typeof AccountUnlockRequestSchema>;
export declare const AccountUnlockConfirmSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export type AccountUnlockConfirmInput = z.infer<typeof AccountUnlockConfirmSchema>;
export declare const AccountDeletionRequestSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AccountDeletionRequestInput = z.infer<typeof AccountDeletionRequestSchema>;
export declare const AccountDeletionConfirmSchema: z.ZodObject<{
    token: z.ZodString;
}, z.core.$strip>;
export type AccountDeletionConfirmInput = z.infer<typeof AccountDeletionConfirmSchema>;
export declare const SsoDiscoveryQuerySchema: z.ZodObject<{
    email: z.ZodString;
}, z.core.$strip>;
export type SsoDiscoveryQueryInput = z.infer<typeof SsoDiscoveryQuerySchema>;
export declare const AdminAuditLogsQuerySchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type AdminAuditLogsQueryInput = z.infer<typeof AdminAuditLogsQuerySchema>;
export declare const MfaRecoveryRequestSchema: z.ZodObject<{
    reason: z.ZodString;
}, z.core.$strip>;
export type MfaRecoveryRequestInput = z.infer<typeof MfaRecoveryRequestSchema>;
export interface AuditLogEntryPublic {
    id: string;
    action: string;
    resource_type: string;
    resource_id: string | null;
    org_id: string | null;
    ip_address: string | null;
    created_at: Date;
    metadata: Record<string, unknown> | null;
}
export interface SsoDiscoveryResult {
    domain: string;
    sso_available: boolean;
    providers: Array<{
        org_id: string;
        org_name: string;
        provider_id: string;
        provider_type: string;
        provider_name: string;
    }>;
    oidc_login_ready: boolean;
    saml_login_ready: boolean;
    configured_link_providers: Array<'google' | 'github'>;
    /** Deployment has OAuth clients configured for passwordless social login. */
    social_login_ready: boolean;
    /** When email is supplied: providers the user has already linked (subset of configured). */
    linked_social_providers: Array<'google' | 'github'>;
}
export declare const SsoLoginSchema: z.ZodObject<{
    email: z.ZodOptional<z.ZodString>;
    provider_id: z.ZodOptional<z.ZodString>;
    remember_me: z.ZodOptional<z.ZodBoolean>;
    device_name: z.ZodOptional<z.ZodString>;
    device_type: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SsoLoginInput = z.infer<typeof SsoLoginSchema>;
export declare const SsoCallbackQuerySchema: z.ZodObject<{
    code: z.ZodOptional<z.ZodString>;
    state: z.ZodOptional<z.ZodString>;
    error: z.ZodOptional<z.ZodString>;
    error_description: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const WebAuthnRegisterOptionsSchema: z.ZodObject<{
    device_name: z.ZodString;
}, z.core.$strip>;
export type WebAuthnRegisterOptionsInput = z.infer<typeof WebAuthnRegisterOptionsSchema>;
export declare const WebAuthnRegisterVerifySchema: z.ZodObject<{
    device_name: z.ZodString;
    challenge: z.ZodString;
    response: z.ZodUnknown;
}, z.core.$strip>;
export type WebAuthnRegisterVerifyInput = z.infer<typeof WebAuthnRegisterVerifySchema>;
export declare const WebAuthnLoginMfaOptionsSchema: z.ZodObject<{
    challenge_id: z.ZodString;
}, z.core.$strip>;
export type WebAuthnLoginMfaOptionsInput = z.infer<typeof WebAuthnLoginMfaOptionsSchema>;
export declare const WebAuthnLoginMfaVerifySchema: z.ZodObject<{
    challenge_id: z.ZodString;
    challenge: z.ZodString;
    response: z.ZodUnknown;
}, z.core.$strip>;
export type WebAuthnLoginMfaVerifyInput = z.infer<typeof WebAuthnLoginMfaVerifySchema>;
export declare const TrustDeviceSchema: z.ZodObject<{
    device_name: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type TrustDeviceInput = z.infer<typeof TrustDeviceSchema>;
export declare const WebAuthnStepUpOptionsSchema: z.ZodObject<{
    challenge_id: z.ZodString;
}, z.core.$strip>;
export type WebAuthnStepUpOptionsInput = z.infer<typeof WebAuthnStepUpOptionsSchema>;
export declare const WebAuthnStepUpVerifySchema: z.ZodObject<{
    challenge_id: z.ZodString;
    challenge: z.ZodString;
    response: z.ZodUnknown;
}, z.core.$strip>;
export type WebAuthnStepUpVerifyInput = z.infer<typeof WebAuthnStepUpVerifySchema>;
export declare const MFADeviceRenameSchema: z.ZodObject<{
    device_name: z.ZodString;
}, z.core.$strip>;
export type MFADeviceRenameInput = z.infer<typeof MFADeviceRenameSchema>;
export declare const AdminForcePasswordResetSchema: z.ZodObject<{
    reason: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type AdminForcePasswordResetInput = z.infer<typeof AdminForcePasswordResetSchema>;
export interface UserDataExport {
    exported_at: string;
    user: UserProfile;
    mfa_devices: Array<{
        id: string;
        type: string;
        name: string;
        verified: boolean;
        is_primary: boolean;
        last_used_at: Date | null;
    }>;
    sessions: SessionInfo[];
}
//# sourceMappingURL=types.d.ts.map