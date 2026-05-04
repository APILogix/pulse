/**
 * Domain types for Auth Module
 * Pure types - no class instantiation overhead
 */

import { z } from 'zod';

// ============================================
// USER TYPES
// ============================================

export const UserStatus = z.enum(['active', 'inactive', 'suspended', 'deleted']);
export type UserStatus = z.infer<typeof UserStatus>;

export const MFAType = z.enum(['totp', 'sms', 'email', 'hardware_key', 'backup_codes']);
export type MFAType = z.infer<typeof MFAType>;

export const OrgRole = z.enum(['owner', 'admin', 'member', 'viewer', 'billing']);
export type OrgRole = z.infer<typeof OrgRole>;

// Database User type (from PostgreSQL)
export interface User {
  id: string; // UUID
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

// Public User Profile (safe to return)
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
  credential_id: string | null; // WebAuthn
  public_key: string | null; // WebAuthn
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

// TOTP Setup Response
export interface TOTPSetup {
  secret: string; // Plain secret - only shown once
  qrCodeUrl: string;
  backupCodes: string[]; // Plain backup codes - only shown once
}

// MFA Challenge
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


export type CreateUserInput = z.infer<typeof CreateUserSchema>;

// Login
export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device_name: z.string().min(1).max(255).optional(),
  remember_me: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof LoginSchema>;

// Login MFA verification
export const LoginMFAVerifySchema = z.object({
  challenge_id: z.string().min(1),
  code: z.string().min(6).max(10),
});

export type LoginMFAVerifyInput = z.infer<typeof LoginMFAVerifySchema>;

// User Profile Update
export const UpdateUserSchema = z.object({
  full_name: z.string().min(1).max(255).optional(),
  avatar_url: z.string().url().optional(),
  timezone: z.string().max(50).optional(),
  locale: z.string().max(10).optional(),
  preferred_mfa_method: MFAType.optional(),
});

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

// Soft Delete (requires password confirmation)
export const DeleteUserSchema = z.object({
  password: z.string().min(1), // For non-SSO users
  reason: z.string().optional(),
});

export type DeleteUserInput = z.infer<typeof DeleteUserSchema>;

// Password management
export const ChangePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: StrongPasswordSchema,
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;

export const ForgotPasswordSchema = z.object({
  email: z.string().email(),
});

export type ForgotPasswordInput = z.infer<typeof ForgotPasswordSchema>;

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  new_password: StrongPasswordSchema,
});

export type ResetPasswordInput = z.infer<typeof ResetPasswordSchema>;

// MFA Setup
export const MFASetupSchema = z.object({
  type: z.enum(['totp', 'sms', 'email']),
  device_name: z.string().min(1).max(255),
  phone_number: z.string().optional(), // For SMS
  email: z.string().email().optional(), // For email MFA
});

export type MFASetupInput = z.infer<typeof MFASetupSchema>;

// MFA Verify Setup
export const MFAVerifySetupSchema = z.object({
  device_id: z.string().uuid(),
  code: z.string().length(6).regex(/^\d+$/),
});

export type MFAVerifySetupInput = z.infer<typeof MFAVerifySetupSchema>;

// MFA Challenge Response
export const MFAVerifySchema = z.object({
  challenge_id: z.string(),
  code: z.string().length(6).regex(/^\d+$/),
});

export type MFAVerifyInput = z.infer<typeof MFAVerifySchema>;

// Backup Codes
export const BackupCodeSchema = z.object({
  code: z.string().length(10).regex(/^[a-z0-9]+$/),
});

export type BackupCodeInput = z.infer<typeof BackupCodeSchema>;

export const BackupCodeVerificationSchema = z.object({
  user_id: z.string().uuid(),
  code: z.string().length(10).regex(/^[a-z0-9]+$/),
});

export type BackupCodeVerificationInput = z.infer<typeof BackupCodeVerificationSchema>;

// ============================================
// WEBHOOK TYPES
// ============================================

export const EmptyBodySchema = z.undefined();
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

export type ClerkWebhookPayload = z.infer<typeof ClerkWebhookSchema>;

// ============================================
// ERROR TYPES
// ============================================

export class AuthError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 400,
    public details?: Record<string, unknown>
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
} as const;

