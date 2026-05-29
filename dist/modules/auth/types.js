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
});
// Login MFA verification — accepts 6-digit TOTP OR 10-hex backup code.
export const LoginMFAVerifySchema = z.object({
    challenge_id: z.string().min(1).max(64),
    code: z
        .string()
        .regex(/^(\d{6}|[a-fA-F0-9]{10})$/, 'Code must be 6 digits or 10 hex chars'),
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
    token: z.string().min(32).max(256),
    new_password: StrongPasswordSchema,
});
export const ResendVerificationSchema = z.object({
    email: z.string().email(),
});
export const VerifyEmailQuerySchema = z.object({
    token: z.string().min(32).max(256),
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
// Backup-code login during a server-issued login challenge. Hex codes are
// case-insensitive on the wire; the service normalizes to lowercase before
// hashing.
export const BackupCodeLoginSchema = z.object({
    challenge_id: z.string().min(1).max(64),
    code: z.string().length(10).regex(/^[a-fA-F0-9]{10}$/),
});
// MFA disable now uses a two-step email-confirmation flow.
//   POST /auth/mfa/disable/request  → emails the user a one-time link.
//   POST /auth/mfa/disable/confirm  → consumes the link and disables MFA.
// The MFA code (TOTP or email OTP) is still required at request-time so a
// stolen access token alone cannot initiate the disable.
export const MFADisableRequestSchema = z.object({
    mfa_code: z.string().length(6).regex(/^\d{6}$/),
});
export const MFADisableConfirmSchema = z.object({
    token: z.string().min(32).max(256),
});
// MFA toggle: enabling still requires a verified device + TOTP. Disabling
// goes through MFADisableRequest/MFADisableConfirm separately, so this
// schema only handles enable.
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
};
//# sourceMappingURL=types.js.map