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
export type UserStatus = z.infer<typeof UserStatus>;

export const MFAType = z.enum(['totp', 'sms', 'email', 'hardware_key', 'backup_codes']);
export type MFAType = z.infer<typeof MFAType>;

// Database User row.
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

// Public-safe profile.
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

// ============================================
// MFA TYPES
// ============================================

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

// ============================================
// SESSION TYPES
// ============================================

export const SessionStatus = z.enum(['active', 'expired', 'revoked', 'terminated_by_admin']);
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
export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Login.
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
  device_name: z.string().min(1).max(255).optional(),
  remember_me: z.boolean().optional(),
});
export type LoginInput = z.infer<typeof LoginSchema>;

// Login MFA verification — accepts 6-digit TOTP OR 10-hex backup code.
export const LoginMFAVerifySchema = z.object({
  challenge_id: z.string().min(1).max(64),
  code: z
    .string()
    .regex(/^(\d{6}|[a-fA-F0-9]{10})$/, 'Code must be 6 digits or 10 hex chars'),
});
export type LoginMFAVerifyInput = z.infer<typeof LoginMFAVerifySchema>;

// Profile update — null allowed for clearing avatar.
export const UpdateUserSchema = z.object({
  full_name: z.string().min(1).max(255).optional(),
  avatar_url: z.union([z.string().url().max(2048), z.null()]).optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
  preferred_mfa_method: MFAType.optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// Self-delete (requires password confirmation if user has one).
export const DeleteUserSchema = z.object({
  password: z.string().min(1).max(256).optional(),
  reason: z.string().max(500).optional(),
});
export type DeleteUserInput = z.infer<typeof DeleteUserSchema>;

// Password management.
export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1).max(256),
  new_password: StrongPasswordSchema,
});
export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});
export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(32).max(256),
  new_password: StrongPasswordSchema,
});
export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

export const ResendVerificationSchema = z.object({
  email: z.string().email(),
});
export type ResendVerificationInput = z.infer<typeof ResendVerificationSchema>;

export const VerifyEmailQuerySchema = z.object({
  token: z.string().min(32).max(256),
});
export type VerifyEmailQueryInput = z.infer<typeof VerifyEmailQuerySchema>;

// MFA setup — supports totp and email device types.
export const MFASetupSchema = z.object({
  type: z.enum(['totp', 'email']),
  device_name: z.string().min(1).max(255),
});
export type MFASetupInput = z.infer<typeof MFASetupSchema>;

// MFA verify-setup — 6-digit code for both TOTP and email OTP.
export const MFAVerifySetupSchema = z.object({
  device_id: z.string().uuid(),
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type MFAVerifySetupInput = z.infer<typeof MFAVerifySetupSchema>;

// Step-up MFA challenge response.
export const MFAVerifySchema = z.object({
  challenge_id: z.string().min(1).max(64),
  code: z.string().length(6).regex(/^\d{6}$/),
});
export type MFAVerifyInput = z.infer<typeof MFAVerifySchema>;

// Backup-code login during a server-issued login challenge. Hex codes are
// case-insensitive on the wire; the service normalizes to lowercase before
// hashing.
export const BackupCodeLoginSchema = z.object({
  challenge_id: z.string().min(1).max(64),
  code: z.string().length(10).regex(/^[a-fA-F0-9]{10}$/),
});
export type BackupCodeLoginInput = z.infer<typeof BackupCodeLoginSchema>;

// MFA disable now uses a two-step email-confirmation flow.
//   POST /auth/mfa/disable/request  → emails the user a one-time link.
//   POST /auth/mfa/disable/confirm  → consumes the link and disables MFA.
// The MFA code (TOTP or email OTP) is still required at request-time so a
// stolen access token alone cannot initiate the disable.
export const MFADisableRequestSchema = z.object({
  mfa_code: z.string().length(6).regex(/^\d{6}$/),
});
export type MFADisableRequestInput = z.infer<typeof MFADisableRequestSchema>;

export const MFADisableConfirmSchema = z.object({
  token: z.string().min(32).max(256),
});
export type MFADisableConfirmInput = z.infer<typeof MFADisableConfirmSchema>;

// MFA toggle: enabling still requires a verified device + TOTP. Disabling
// goes through MFADisableRequest/MFADisableConfirm separately, so this
// schema only handles enable.
export const MFAToggleSchema = z.object({
  enabled: z.literal(true),
  mfa_code: z.string().length(6).regex(/^\d{6}$/),
});
export type MFAToggleInput = z.infer<typeof MFAToggleSchema>;

// Removing an MFA device. If it's the LAST verified device, current_password
// is required (we never accept a TOTP from the device being removed).
export const MFADeviceRemoveSchema = z.object({
  current_password: z.string().min(1).max(256).optional(),
});
export type MFADeviceRemoveInput = z.infer<typeof MFADeviceRemoveSchema>;

export const SuspendUserSchema = z.object({
  reason: z.string().min(10).max(500),
});
export type SuspendUserInput = z.infer<typeof SuspendUserSchema>;

export const ListUsersQuerySchema = z.object({
  status: UserStatus.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  search: z.string().min(1).max(255).optional(),
});
export type ListUsersQueryInput = z.infer<typeof ListUsersQuerySchema>;

export const RegenerateBackupCodesSchema = z.object({
  mfa_code: z.string().length(6).regex(/^\d{6}$/),
});
export type RegenerateBackupCodesInput = z.infer<typeof RegenerateBackupCodesSchema>;

// ============================================
// ERROR TYPES
// ============================================

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>,
  ) {
    super(message);
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
} as const;
