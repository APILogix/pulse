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
import { BACKUP_CODE_HEX_LENGTH, BACKUP_CODE_HEX_REGEX, } from './constants.js';
// ============================================
// USER TYPES
// ============================================
export const UserStatus = z.enum(['active', 'inactive', 'suspended', 'deleted']);
export const MFAType = z.enum(['totp', 'sms', 'email', 'hardware_key', 'backup_codes']);
// ============================================
// SESSION TYPES
// ============================================
export const SessionStatus = z.enum(['active', 'expired', 'revoked', 'terminated_by_admin']);
// ============================================
// API REQUEST/RESPONSE SCHEMAS
// ============================================
const MagicLinkTokenSchema = z
    .string()
    .regex(/^[A-Fa-f0-9]{64,128}$/, 'Invalid token format');
export const StrongPasswordSchema = z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character');
// Registration. Terms/privacy acceptance is required (GDPR Art. 7
// demonstrability). Avatar URL is optional and may be omitted; PATCH allows
// explicit null to clear (see UpdateUserSchema below).
export const CreateUserSchema = z.object({
    email: z.string().email().max(255),
    full_name: z.string().min(1).max(255),
    password: StrongPasswordSchema,
    avatar_url: z.string().url().max(2048).optional(),
    accept_terms: z.literal(true, {
        message: 'You must accept the terms of service',
    }),
    accept_privacy: z.literal(true, {
        message: 'You must accept the privacy policy',
    }),
    marketing_consent: z.boolean().optional().default(false),
    terms_version: z.string().max(32).optional(),
    privacy_version: z.string().max(32).optional(),
});
// Login.
export const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1).max(256),
    device_name: z.string().min(1).max(255).optional(),
    remember_me: z.boolean().optional(),
    trust_device: z.boolean().optional(),
});
export const LoginResponseSchema = z.object({
    access_token: z.string(),
    expires_at: z.date(),
    session_id: z.string(),
    token_type: z.literal('Bearer'),
    user: z.object({
        id: z.string().uuid(),
        email: z.string().email(),
        name: z.string(),
    }).optional(),
    default_org_slug: z.string().nullable().optional(),
    organizations: z.array(z.object({
        id: z.string().uuid(),
        slug: z.string(),
        name: z.string(),
        role: z.string(),
    })).optional(),
});
// Login MFA verification — TOTP or email OTP only (6 digits).
// Backup codes use POST /auth/login/backup-code.
export const LoginMFAVerifySchema = z.object({
    challenge_id: z.string().min(1).max(64),
    code: z.string().length(6).regex(/^\d{6}$/, 'Code must be 6 digits'),
});
/** Backup-code login during an active server-issued MFA challenge. */
export const BackupCodeLoginSchema = z.object({
    challenge_id: z.string().min(1).max(64),
    code: z
        .string()
        .length(BACKUP_CODE_HEX_LENGTH)
        .regex(BACKUP_CODE_HEX_REGEX, `Code must be ${BACKUP_CODE_HEX_LENGTH} hex characters`),
});
export const EmailMfaResendSchema = z.object({
    device_id: z.string().uuid(),
});
// Profile update — null allowed for clearing avatar.
export const UpdateUserSchema = z.object({
    full_name: z.string().min(1).max(255).optional(),
    avatar_url: z.union([z.string().url().max(2048), z.null()]).optional(),
    timezone: z.string().max(50).optional(),
    locale: z.string().max(10).optional(),
    preferred_mfa_method: MFAType.optional(),
});
// Self-delete (requires password confirmation if user has one).
export const DeleteUserSchema = z.object({
    password: z.string().min(1).max(256).optional(),
    reason: z.string().max(500).optional(),
});
// Password management.
export const ChangePasswordSchema = z.object({
    current_password: z.string().min(1).max(256),
    new_password: StrongPasswordSchema,
});
export const ForgotPasswordSchema = z.object({
    email: z.string().email(),
});
export const ResetPasswordSchema = z.object({
    token: MagicLinkTokenSchema,
    new_password: StrongPasswordSchema,
});
export const ResendVerificationSchema = z.object({
    email: z.string().email(),
});
export const VerifyEmailQuerySchema = z.object({
    token: MagicLinkTokenSchema,
});
export const VerifyEmailConfirmSchema = z.object({
    token: MagicLinkTokenSchema,
});
// MFA setup — supports totp and email device types.
export const MFASetupSchema = z.object({
    type: z.enum(['totp', 'email']),
    device_name: z.string().min(1).max(255),
});
// MFA verify-setup — 6-digit code for both TOTP and email OTP.
export const MFAVerifySetupSchema = z.object({
    device_id: z.string().uuid(),
    code: z.string().length(6).regex(/^\d{6}$/),
});
// Step-up MFA challenge response.
export const MFAVerifySchema = z.object({
    challenge_id: z.string().min(1).max(64),
    code: z.string().length(6).regex(/^\d{6}$/),
});
// MFA disable is protected by the route-level step-up gate. The body remains
// permissive for older clients that still send an MFA code, but the current
// single-step flow relies on verified step-up freshness.
export const MFADisableRequestSchema = z.object({
    mfa_code: z.string().length(6).regex(/^\d{6}$/).optional(),
});
export const MFADisableConfirmSchema = z.object({
    token: MagicLinkTokenSchema,
});
// MFA toggle: enabling still requires a verified device + MFA code. Disabling
// uses the dedicated step-up protected disable route.
export const MFAToggleSchema = z.object({
    enabled: z.literal(true),
    mfa_code: z.string().length(6).regex(/^\d{6}$/),
});
// Removing an MFA device. If it's the LAST verified device, current_password
// is required (we never accept a TOTP from the device being removed).
export const MFADeviceRemoveSchema = z.object({
    current_password: z.string().min(1).max(256).optional(),
});
export const SuspendUserSchema = z.object({
    reason: z.string().min(10).max(500),
});
export const AdminLockUserSchema = z.object({
    reason: z.string().min(10).max(500),
});
export const ListUsersQuerySchema = z.object({
    status: UserStatus.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
    search: z.string().min(1).max(255).optional(),
});
export const RegenerateBackupCodesSchema = z.object({
    mfa_code: z.string().length(6).regex(/^\d{6}$/),
});
// ============================================
// ERROR TYPES
// ============================================
export class AuthError extends Error {
    code;
    statusCode;
    details;
    constructor(message, code, statusCode = 400, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = 'AuthError';
    }
}
export const AuthErrorCodes = {
    USER_NOT_FOUND: 'USER_NOT_FOUND',
    USER_EXISTS: 'USER_EXISTS',
    INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
    PASSWORD_EXPIRED: 'PASSWORD_EXPIRED',
    EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
    PASSWORD_REUSE_NOT_ALLOWED: 'PASSWORD_REUSE_NOT_ALLOWED',
    PASSWORD_RESET_INVALID: 'PASSWORD_RESET_INVALID',
    PASSWORD_RESET_EXPIRED: 'PASSWORD_RESET_EXPIRED',
    USER_SUSPENDED: 'USER_SUSPENDED',
    USER_DELETED: 'USER_DELETED',
    ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
    MFA_REQUIRED: 'MFA_REQUIRED',
    MFA_INVALID: 'MFA_INVALID',
    MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
    MFA_NOT_ENABLED: 'MFA_NOT_ENABLED',
    MFA_CHALLENGE_EXPIRED: 'MFA_CHALLENGE_EXPIRED',
    MFA_DEVICE_NOT_FOUND: 'MFA_DEVICE_NOT_FOUND',
    MFA_DISABLE_INVALID: 'MFA_DISABLE_INVALID',
    STEP_UP_REQUIRED: 'STEP_UP_REQUIRED',
    SESSION_INVALID: 'SESSION_INVALID',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
    PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
    PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
    RATE_LIMITED: 'RATE_LIMITED',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    EMAIL_VERIFICATION_INVALID: 'EMAIL_VERIFICATION_INVALID',
    EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_OPERATION: 'INVALID_OPERATION',
    SSO_REQUIRED: 'SSO_REQUIRED',
    EMAIL_IN_USE: 'EMAIL_IN_USE',
    DELETION_ALREADY_SCHEDULED: 'DELETION_ALREADY_SCHEDULED',
    OIDC_NOT_CONFIGURED: 'OIDC_NOT_CONFIGURED',
    OIDC_CALLBACK_INVALID: 'OIDC_CALLBACK_INVALID',
    WEBAUTHN_CHALLENGE_INVALID: 'WEBAUTHN_CHALLENGE_INVALID',
    JIT_PROVISIONING_DISABLED: 'JIT_PROVISIONING_DISABLED',
    SSO_DOMAIN_MISMATCH: 'SSO_DOMAIN_MISMATCH',
    SSO_NOT_CONFIGURED: 'SSO_NOT_CONFIGURED',
    SAML_NOT_CONFIGURED: 'SAML_NOT_CONFIGURED',
    SAML_RESPONSE_INVALID: 'SAML_RESPONSE_INVALID',
    IDENTITY_PROVIDER_NOT_CONFIGURED: 'IDENTITY_PROVIDER_NOT_CONFIGURED',
    IDENTITY_ALREADY_LINKED: 'IDENTITY_ALREADY_LINKED',
    IDENTITY_LINK_FAILED: 'IDENTITY_LINK_FAILED',
    SOCIAL_LOGIN_FAILED: 'SOCIAL_LOGIN_FAILED',
    SCIM_UNAUTHORIZED: 'SCIM_UNAUTHORIZED',
    SCIM_NOT_FOUND: 'SCIM_NOT_FOUND',
    SCIM_CONFLICT: 'SCIM_CONFLICT',
};
export const SocialLoginSchema = z.object({
    remember_me: z.boolean().optional(),
    device_name: z.string().max(255).optional(),
    device_type: z.string().max(50).optional(),
});
export const AccountUnlockRequestSchema = z.object({
    email: z.string().email(),
});
export const AccountUnlockConfirmSchema = z.object({
    token: MagicLinkTokenSchema,
});
export const AccountDeletionRequestSchema = z.object({
    reason: z.string().max(500).optional(),
});
export const AccountDeletionConfirmSchema = z.object({
    token: MagicLinkTokenSchema,
});
export const SsoDiscoveryQuerySchema = z.object({
    email: z.string().email(),
});
export const AdminAuditLogsQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0),
});
export const MfaRecoveryRequestSchema = z.object({
    reason: z.string().min(20).max(1000),
});
export const SsoLoginSchema = z.object({
    email: z.string().email().optional(),
    provider_id: z.string().uuid().optional(),
    remember_me: z.boolean().optional(),
    device_name: z.string().max(255).optional(),
    device_type: z.string().max(50).optional(),
}).refine((d) => d.email || d.provider_id, {
    message: 'email or provider_id is required',
});
export const SsoCallbackQuerySchema = z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
});
export const WebAuthnRegisterOptionsSchema = z.object({
    device_name: z.string().min(1).max(255),
});
export const WebAuthnRegisterVerifySchema = z.object({
    device_name: z.string().min(1).max(255),
    challenge: z.string().min(1),
    response: z.unknown(),
});
export const WebAuthnLoginMfaOptionsSchema = z.object({
    challenge_id: z.string().min(1),
});
export const WebAuthnLoginMfaVerifySchema = z.object({
    challenge_id: z.string().min(1),
    challenge: z.string().min(1),
    response: z.unknown(),
});
export const TrustDeviceSchema = z.object({
    device_name: z.string().max(255).optional(),
});
export const WebAuthnStepUpOptionsSchema = z.object({
    challenge_id: z.string().min(1),
});
export const WebAuthnStepUpVerifySchema = z.object({
    challenge_id: z.string().min(1),
    challenge: z.string().min(1),
    response: z.unknown(),
});
export const MFADeviceRenameSchema = z.object({
    device_name: z.string().min(1).max(255),
});
export const AdminForcePasswordResetSchema = z.object({
    reason: z.string().max(500).optional(),
});
//# sourceMappingURL=types.js.map