/**
 * Domain types for Auth Module
 * Pure types - no class instantiation overhead
 */
import { z } from 'zod';
// ============================================
// USER TYPES
// ============================================
export const UserStatus = z.enum(['active', 'inactive', 'suspended', 'deleted']);
export const MFAType = z.enum(['totp', 'sms', 'email', 'hardware_key', 'backup_codes']);
export const OrgRole = z.enum(['owner', 'admin', 'member', 'viewer', 'billing']);
// ============================================
// SESSION TYPES
// ============================================
export const SessionStatus = z.enum(['active', 'expired', 'revoked', 'terminated_by_admin']);
// ============================================
// API REQUEST/RESPONSE TYPES (Zod Schemas)
// ============================================
export const StrongPasswordSchema = z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(100)
    .regex(/[A-Z]/, "Must contain at least one uppercase letter")
    .regex(/[a-z]/, "Must contain at least one lowercase letter")
    .regex(/[0-9]/, "Must contain at least one number")
    .regex(/[^A-Za-z0-9]/, "Must contain at least one special character");
// User Creation 
export const CreateUserSchema = z.object({
    email: z.string().email(),
    full_name: z.string().min(1).max(255),
    password: StrongPasswordSchema,
    avatar_url: z.string().url().optional(),
});
// Login
export const LoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
    device_name: z.string().min(1).max(255).optional(),
    remember_me: z.boolean().optional(),
});
// Login MFA verification
export const LoginMFAVerifySchema = z.object({
    challenge_id: z.string().min(1),
    code: z.string().min(6).max(10),
});
// User Profile Update
export const UpdateUserSchema = z.object({
    full_name: z.string().min(1).max(255).optional(),
    avatar_url: z.string().url().optional(),
    timezone: z.string().max(50).optional(),
    locale: z.string().max(10).optional(),
    preferred_mfa_method: MFAType.optional(),
});
// Soft Delete (requires password confirmation)
export const DeleteUserSchema = z.object({
    password: z.string().min(1), // For non-SSO users
    reason: z.string().optional(),
});
// Password management
export const ChangePasswordSchema = z.object({
    current_password: z.string().min(1),
    new_password: StrongPasswordSchema,
});
export const ForgotPasswordSchema = z.object({
    email: z.string().email(),
});
export const ResetPasswordSchema = z.object({
    token: z.string().min(1),
    new_password: StrongPasswordSchema,
});
// MFA Setup
export const MFASetupSchema = z.object({
    type: z.enum(['totp', 'sms', 'email']),
    device_name: z.string().min(1).max(255),
    phone_number: z.string().optional(), // For SMS
    email: z.string().email().optional(), // For email MFA
});
// MFA Verify Setup
export const MFAVerifySetupSchema = z.object({
    device_id: z.string().uuid(),
    code: z.string().length(6).regex(/^\d+$/),
});
// MFA Challenge Response
export const MFAVerifySchema = z.object({
    challenge_id: z.string(),
    code: z.string().length(6).regex(/^\d+$/),
});
// Backup Codes
export const BackupCodeSchema = z.object({
    code: z.string().length(10).regex(/^[a-z0-9]+$/),
});
export const BackupCodeVerificationSchema = z.object({
    user_id: z.string().uuid(),
    code: z.string().length(10).regex(/^[a-z0-9]+$/),
});
// ============================================
// WEBHOOK TYPES
// ============================================
export const ClerkWebhookSchema = z.object({
    type: z.enum(['user.created', 'user.updated', 'user.deleted', 'session.created', 'session.ended']),
    data: z.object({
        id: z.string(), // Clerk user/session ID
        email_addresses: z.array(z.object({
            email_address: z.string().email(),
            verification: z.object({ status: z.string() }).optional(),
        })).optional(),
        first_name: z.string().optional(),
        last_name: z.string().optional(),
        image_url: z.string().optional(),
        deleted: z.boolean().optional(),
    }),
    timestamp: z.number(),
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
    PASSWORD_REUSE_NOT_ALLOWED: 'PASSWORD_REUSE_NOT_ALLOWED',
    PASSWORD_RESET_INVALID: 'PASSWORD_RESET_INVALID',
    PASSWORD_RESET_EXPIRED: 'PASSWORD_RESET_EXPIRED',
    USER_SUSPENDED: 'USER_SUSPENDED',
    USER_DELETED: 'USER_DELETED',
    MFA_REQUIRED: 'MFA_REQUIRED',
    MFA_INVALID: 'MFA_INVALID',
    MFA_ALREADY_ENABLED: 'MFA_ALREADY_ENABLED',
    MFA_NOT_ENABLED: 'MFA_NOT_ENABLED',
    MFA_CHALLENGE_EXPIRED: 'MFA_CHALLENGE_EXPIRED',
    SESSION_INVALID: 'SESSION_INVALID',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
    PASSWORD_INCORRECT: 'PASSWORD_INCORRECT',
    RATE_LIMITED: 'RATE_LIMITED',
    WEBHOOK_INVALID: 'WEBHOOK_INVALID',
    INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
    EMAIL_VERIFICATION_INVALID: 'EMAIL_VERIFICATION_INVALID',
};
//# sourceMappingURL=types.js.map