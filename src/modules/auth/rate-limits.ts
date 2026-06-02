/**
 * Auth route rate limits (in-process LRU).
 *
 * Intentionally Redis-free for bootstrap deployments. See lru-rate-limit.ts.
 */
import { createHash } from 'crypto';
import type { FastifyRequest } from 'fastify';

import { ipPlusIdentityKey, lruRateLimit } from './lru-rate-limit.js';
import { normalizeEmail } from './utils.js';

const MS_MIN = 60 * 1000;
const MS_15_MIN = 15 * MS_MIN;
const MS_HOUR = 60 * MS_MIN;

function emailHashFromBody(req: FastifyRequest): string {
  const body = req.body as { email?: string } | undefined;
  if (!body?.email) return 'no-email';
  return createHash('sha256')
    .update(normalizeEmail(body.email))
    .digest('hex')
    .slice(0, 24);
}

function userIdFromAuth(req: FastifyRequest): string {
  const u = (req as FastifyRequest & { user?: { id: string } }).user;
  return u?.id ?? req.ip ?? 'anonymous';
}

const ipAndEmail = ipPlusIdentityKey(emailHashFromBody);

export const loginRateLimit = lruRateLimit({
  scope: 'login',
  max: 10,
  windowMs: MS_15_MIN,
  keyGenerator: ipAndEmail,
});

export const loginMfaRateLimit = lruRateLimit({
  scope: 'login-mfa',
  max: 15,
  windowMs: MS_15_MIN,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const registerRateLimit = lruRateLimit({
  scope: 'register',
  max: 5,
  windowMs: MS_HOUR,
  keyGenerator: ipAndEmail,
});

export const forgotPasswordRateLimit = lruRateLimit({
  scope: 'forgot-password',
  max: 5,
  windowMs: MS_HOUR,
  keyGenerator: ipAndEmail,
});

export const resendVerificationRateLimit = lruRateLimit({
  scope: 'resend-verification',
  max: 5,
  windowMs: MS_HOUR,
  keyGenerator: ipAndEmail,
});

export const verifyEmailRateLimit = lruRateLimit({
  scope: 'verify-email',
  max: 20,
  windowMs: MS_HOUR,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const resetPasswordRateLimit = lruRateLimit({
  scope: 'reset-password',
  max: 10,
  windowMs: MS_HOUR,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const refreshSessionRateLimit = lruRateLimit({
  scope: 'refresh',
  max: 60,
  windowMs: MS_15_MIN,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const accountUnlockRequestRateLimit = lruRateLimit({
  scope: 'account-unlock',
  max: 5,
  windowMs: MS_HOUR,
  keyGenerator: ipAndEmail,
});

export const emailChangeRequestRateLimit = lruRateLimit({
  scope: 'email-change',
  max: 3,
  windowMs: MS_HOUR,
  keyGenerator: (req) => {
    const u = (req as FastifyRequest & { user?: { id: string } }).user;
    return u?.id ?? req.ip ?? 'anonymous';
  },
});

export const ssoDiscoveryRateLimit = lruRateLimit({
  scope: 'sso-discovery',
  max: 30,
  windowMs: MS_15_MIN,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const ssoLoginRateLimit = lruRateLimit({
  scope: 'sso-login',
  max: 20,
  windowMs: MS_15_MIN,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const ssoCallbackRateLimit = lruRateLimit({
  scope: 'sso-callback',
  max: 30,
  windowMs: MS_15_MIN,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const webauthnRateLimit = lruRateLimit({
  scope: 'webauthn',
  max: 30,
  windowMs: MS_15_MIN,
  keyGenerator: userIdFromAuth,
});

/** Token consumption endpoints (unlock, email change, MFA disable, deletion). */
export const tokenConfirmRateLimit = lruRateLimit({
  scope: 'token-confirm',
  max: 15,
  windowMs: MS_HOUR,
  keyGenerator: (req) => req.ip || 'unknown',
});

export const mfaEmailResendRateLimit = lruRateLimit({
  scope: 'mfa-email-resend',
  max: 3,
  windowMs: MS_15_MIN,
  keyGenerator: (req) => {
    const body = req.body as { device_id?: string } | undefined;
    const deviceId = body?.device_id ?? 'unknown-device';
    return `${userIdFromAuth(req)}:${deviceId}`;
  },
});
