/**
 * Phase 3 identity flows: email change, account unlock, GDPR export,
 * delayed deletion, SSO discovery, MFA recovery intake, admin audit read.
 */
import { createHash } from 'crypto';

import { env as config } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { authEmail } from './auth-email.js';
import {
  accountDeletionConfirmTemplate,
  accountUnlockTemplate,
  emailChangeConfirmTemplate,
} from '../../shared/email/templates.js';
import { logAudit } from '../../shared/middleware/audit-logger.js';
import { verifyPassword } from '../../shared/utils/encryption.js';

import { revokeAllUserTokens as cacheRevokeAllUserTokens } from './cache.js';
import {
  isProviderConfigured,
  listConfiguredLinkProviders,
  type LinkableProvider,
} from './identity-link.config.js';
import { getPasswordPolicy } from './policy.service.js';
import * as repository from './repository.js';
import {
  AuthError,
  AuthErrorCodes,
  type AccountDeletionConfirmInput,
  type AccountDeletionRequestInput,
  type AccountUnlockConfirmInput,
  type AccountUnlockRequestInput,
  type AdminAuditLogsQueryInput,
  type AuditLogEntryPublic,
  type EmailChangeConfirmInput,
  type EmailChangeRequestInput,
  type MfaRecoveryRequestInput,
  type SsoDiscoveryQueryInput,
  type SsoDiscoveryResult,
  type User,
  type UserDataExport,
  type UserProfile,
} from './types.js';
import {
  ACCOUNT_DELETION_GRACE_SECONDS,
  ACCOUNT_DELETION_TOKEN_TTL_SECONDS,
  ACCOUNT_UNLOCK_TTL_SECONDS,
  EMAIL_CHANGE_TTL_SECONDS,
  generateEmailFlowToken,
  hashEmailFlowToken,
  normalizeEmail,
} from './utils.js';

function profileFromUser(user: User): UserProfile {
  return {
    id: user.id,
    email: user.email,
    email_verified: user.email_verified,
    full_name: user.full_name,
    avatar_url: user.avatar_url,
    status: user.status,
    is_admin: user.is_admin === true,
    mfa_enabled: user.mfa_enabled,
    timezone: user.timezone,
    locale: user.locale,
    last_login_at: user.last_login_at,
    created_at: user.created_at,
  };
}

function emailToHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function getBaseUrl(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, '');
}

function buildEmailChangeUrl(token: string): string {
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/security/email/confirm?token=${encodeURIComponent(token)}`;
}

function buildAccountUnlockUrl(token: string): string {
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/account/unlock?token=${encodeURIComponent(token)}`;
}

function buildAccountDeletionConfirmUrl(token: string): string {
  return `${getBaseUrl(config.FRONTEND_URL, config.APP_URL)}/account/delete/confirm?token=${encodeURIComponent(token)}`;
}

function toMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}

const GENERIC_UNLOCK_MESSAGE =
  'If the account exists and is locked, an unlock email has been sent';

export async function requestEmailChange(
  userId: string,
  input: EmailChangeRequestInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  if (!user.password_hash) {
    throw new AuthError(
      'Password verification required',
      AuthErrorCodes.PASSWORD_REQUIRED,
      400,
    );
  }
  const valid = await verifyPassword(input.current_password, user.password_hash);
  if (!valid) {
    throw new AuthError(
      'Current password is incorrect',
      AuthErrorCodes.PASSWORD_INCORRECT,
      401,
    );
  }

  const newEmail = normalizeEmail(input.new_email);
  if (newEmail === normalizeEmail(user.email)) {
    throw new AuthError(
      'New email must differ from current email',
      AuthErrorCodes.VALIDATION_ERROR,
      400,
    );
  }

  const collision = await repository.findUserByEmailHash(emailToHash(newEmail));
  if (collision && collision.id !== userId) {
    throw new AuthError(
      'Email address is not available',
      AuthErrorCodes.EMAIL_IN_USE,
      409,
    );
  }

  const token = generateEmailFlowToken();
  await repository.createEmailVerification({
    user_id: userId,
    email: newEmail,
    token_hash: hashEmailFlowToken('email_change', token),
    purpose: 'email_change',
    expires_at: new Date(Date.now() + EMAIL_CHANGE_TTL_SECONDS * 1000),
  });

  await authEmail.send({
    to: newEmail,
    ...emailChangeConfirmTemplate({
      appName: config.APP_NAME,
      userName: user.full_name,
      newEmail,
      actionUrl: buildEmailChangeUrl(token),
      expiresInMinutes: toMinutes(EMAIL_CHANGE_TTL_SECONDS),
    }),
  });

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.email_change_requested',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { new_email_domain: newEmail.split('@')[1] },
  });

  return {
    message:
      'Confirmation email sent to the new address. Your current email remains active until you confirm.',
  };
}

export async function confirmEmailChange(
  input: EmailChangeConfirmInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const tokenHash = hashEmailFlowToken('email_change', input.token);

  let userId: string | null = null;

  await repository.withTransaction(async (client) => {
    const consumed = await repository.consumeEmailVerificationToken(
      tokenHash,
      'email_change',
      client,
    );
    if (!consumed) {
      throw new AuthError(
        'Invalid or expired email change token',
        AuthErrorCodes.EMAIL_VERIFICATION_INVALID,
        400,
      );
    }

    const collision = await repository.findUserByEmailHash(
      emailToHash(consumed.email),
      client,
    );
    if (collision && collision.id !== consumed.user_id) {
      throw new AuthError(
        'Email address is no longer available',
        AuthErrorCodes.EMAIL_IN_USE,
        409,
      );
    }

    const updated = await repository.updateUserEmail(
      consumed.user_id,
      consumed.email,
      emailToHash(consumed.email),
      client,
    );
    if (!updated) {
      throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    userId = updated.id;
  });

  if (userId) {
    cacheRevokeAllUserTokens(userId);
    await repository.revokeAllUserSessions(userId, 'Email address changed');

    logAudit({
      user_id: userId,
      org_id: null,
      action: 'user.email_changed',
      resource_type: 'user',
      resource_id: userId,
      ip_address: ipAddress,
      request_id: requestId,
    });
  }

  return { message: 'Email address updated successfully' };
}

export async function requestAccountUnlock(
  input: AccountUnlockRequestInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const emailHash = emailToHash(input.email);
  const user = await repository.findUserByEmailHash(emailHash);

  if (
    user &&
    user.locked_until &&
    user.locked_until > new Date() &&
    !user.deleted_at
  ) {
    const token = generateEmailFlowToken();
    await repository.createEmailVerification({
      user_id: user.id,
      email: normalizeEmail(user.email),
      token_hash: hashEmailFlowToken('account_unlock', token),
      purpose: 'account_unlock',
      expires_at: new Date(Date.now() + ACCOUNT_UNLOCK_TTL_SECONDS * 1000),
    });

    try {
      await authEmail.send({
        to: user.email,
        ...accountUnlockTemplate({
          appName: config.APP_NAME,
          userName: user.full_name,
          actionUrl: buildAccountUnlockUrl(token),
          expiresInMinutes: toMinutes(ACCOUNT_UNLOCK_TTL_SECONDS),
        }),
      });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Account unlock email failed');
    }

    logAudit({
      user_id: user.id,
      org_id: null,
      action: 'user.unlock_requested',
      resource_type: 'user',
      resource_id: user.id,
      ip_address: ipAddress,
      request_id: requestId,
    });
  }

  return { message: GENERIC_UNLOCK_MESSAGE };
}

export async function confirmAccountUnlock(
  input: AccountUnlockConfirmInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const tokenHash = hashEmailFlowToken('account_unlock', input.token);

  let userId: string | null = null;

  await repository.withTransaction(async (client) => {
    const consumed = await repository.consumeEmailVerificationToken(
      tokenHash,
      'account_unlock',
      client,
    );
    if (!consumed) {
      throw new AuthError(
        'Invalid or expired unlock token',
        AuthErrorCodes.EMAIL_VERIFICATION_INVALID,
        400,
      );
    }

    const unlocked = await repository.adminUnlockUser(consumed.user_id, client);
    if (!unlocked) {
      throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    userId = unlocked.id;
  });

  if (userId) {
    logAudit({
      user_id: userId,
      org_id: null,
      action: 'user.unlocked',
      resource_type: 'user',
      resource_id: userId,
      ip_address: ipAddress,
      request_id: requestId,
      metadata: { method: 'email_link' },
    });
  }

  return { message: 'Account unlocked. You may sign in again.' };
}

export async function requestAccountDeletion(
  userId: string,
  input: AccountDeletionRequestInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string; scheduled_at: string }> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  if (user.deletion_scheduled_at) {
    throw new AuthError(
      'Account deletion is already scheduled',
      AuthErrorCodes.DELETION_ALREADY_SCHEDULED,
      409,
      { scheduled_at: user.deletion_scheduled_at.toISOString() },
    );
  }

  const scheduledAt = new Date(
    Date.now() + ACCOUNT_DELETION_GRACE_SECONDS * 1000,
  );
  const token = generateEmailFlowToken();

  await repository.createEmailVerification({
    user_id: userId,
    email: normalizeEmail(user.email),
    token_hash: hashEmailFlowToken('account_deletion', token),
    purpose: 'account_deletion',
    expires_at: new Date(
      Date.now() + ACCOUNT_DELETION_TOKEN_TTL_SECONDS * 1000,
    ),
  });

  await authEmail.send({
    to: user.email,
    ...accountDeletionConfirmTemplate({
      appName: config.APP_NAME,
      userName: user.full_name,
      actionUrl: buildAccountDeletionConfirmUrl(token),
      expiresInMinutes: toMinutes(ACCOUNT_DELETION_TOKEN_TTL_SECONDS),
      scheduledFor: scheduledAt.toISOString(),
    }),
  });

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.deletion_requested',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: {
      reason: input.reason ?? null,
      proposed_scheduled_at: scheduledAt.toISOString(),
    },
  });

  return {
    message:
      'Confirmation email sent. Your account is not scheduled until you confirm the link.',
    scheduled_at: scheduledAt.toISOString(),
  };
}

export async function confirmAccountDeletion(
  input: AccountDeletionConfirmInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string; scheduled_at: string }> {
  const tokenHash = hashEmailFlowToken('account_deletion', input.token);
  const scheduledAt = new Date(
    Date.now() + ACCOUNT_DELETION_GRACE_SECONDS * 1000,
  );

  let userId: string | null = null;

  await repository.withTransaction(async (client) => {
    const consumed = await repository.consumeEmailVerificationToken(
      tokenHash,
      'account_deletion',
      client,
    );
    if (!consumed) {
      throw new AuthError(
        'Invalid or expired deletion confirmation token',
        AuthErrorCodes.EMAIL_VERIFICATION_INVALID,
        400,
      );
    }

    const scheduled = await repository.scheduleAccountDeletion(
      consumed.user_id,
      scheduledAt,
      client,
    );
    if (!scheduled) {
      throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
    }
    userId = scheduled.id;
  });

  if (userId) {
    logAudit({
      user_id: userId,
      org_id: null,
      action: 'user.deletion_scheduled',
      resource_type: 'user',
      resource_id: userId,
      ip_address: ipAddress,
      request_id: requestId,
      metadata: { scheduled_at: scheduledAt.toISOString() },
    });
  }

  return {
    message: `Account deletion scheduled for ${scheduledAt.toISOString()}`,
    scheduled_at: scheduledAt.toISOString(),
  };
}

export async function exportUserData(userId: string): Promise<UserDataExport> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  const [devices, sessions] = await Promise.all([
    repository.findMFADevicesByUserId(userId, true),
    repository.listActiveSessionsByUser(userId),
  ]);

  return {
    exported_at: new Date().toISOString(),
    user: profileFromUser(user),
    mfa_devices: devices.map((d) => ({
      id: d.id,
      type: d.device_type,
      name: d.device_name,
      verified: d.verified,
      is_primary: d.is_primary,
      last_used_at: d.last_used_at,
    })),
    sessions: sessions.map((s) => ({
      id: s.id,
      device_name: s.device_name,
      device_type: s.device_type,
      ip_address: s.ip_address,
      ip_geo_country: s.ip_geo_country,
      last_active_at: s.last_active_at,
      created_at: s.created_at,
      is_current: false,
    })),
  };
}

export async function discoverSso(
  input: SsoDiscoveryQueryInput,
): Promise<SsoDiscoveryResult> {
  const email = normalizeEmail(input.email);
  const domain = email.split('@')[1];
  if (!domain) {
    throw new AuthError('Invalid email', AuthErrorCodes.VALIDATION_ERROR, 400);
  }

  const providers = await repository.findSsoProvidersByEmailDomain(domain);
  const oidcProvider = await repository.findOidcProviderForEmailDomain(domain);
  const samlProvider = await repository.findSamlProviderForEmailDomain(domain);
  const configuredLink = listConfiguredLinkProviders();
  const user = await repository.findUserByEmailHash(emailToHash(email));
  const linked: LinkableProvider[] = [];
  if (user) {
    const identities = await repository.listLinkedIdentities(user.id);
    for (const id of identities) {
      if (isProviderConfigured(id.provider as LinkableProvider)) {
        linked.push(id.provider as LinkableProvider);
      }
    }
  }

  return {
    domain,
    sso_available: providers.length > 0,
    providers: providers.map((p) => ({
      org_id: p.org_id,
      org_name: p.org_name,
      provider_id: p.provider_id,
      provider_type: p.provider_type,
      provider_name: p.provider_name,
    })),
    oidc_login_ready: oidcProvider !== null,
    saml_login_ready: samlProvider !== null,
    configured_link_providers: configuredLink,
    social_login_ready: configuredLink.length > 0,
    linked_social_providers: linked,
  };
}

export async function getEmailVerificationStatus(userId: string): Promise<{
  email_verified: boolean;
  email_verified_at: Date | null;
}> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  return {
    email_verified: user.email_verified,
    email_verified_at: user.email_verified_at,
  };
}

export async function requestMfaRecovery(
  userId: string,
  input: MfaRecoveryRequestInput,
  ipAddress: string,
  requestId: string,
): Promise<{ message: string }> {
  const user = await repository.findUserById(userId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }
  if (!user.mfa_enabled) {
    throw new AuthError('MFA is not enabled', AuthErrorCodes.MFA_NOT_ENABLED, 400);
  }

  await repository
    .recordSecurityEvent({
      event_type: 'mfa_recovery_requested',
      severity: 6,
      user_id: userId,
      ip_address: ipAddress,
      description: 'User requested MFA recovery assistance',
      evidence: { reason_length: input.reason.length },
      action_taken: 'pending_review',
    })
    .catch((err) => {
      logger.warn({ err, userId }, 'recordSecurityEvent failed');
    });

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.mfa_recovery_requested',
    resource_type: 'user',
    resource_id: userId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { reason_provided: true },
  });

  return {
    message:
      'Your MFA recovery request was recorded. Support will verify your identity before resetting MFA.',
  };
}

export async function listUserAuditEvents(
  targetUserId: string,
  adminId: string,
  isAdmin: boolean,
  query: AdminAuditLogsQueryInput,
  ipAddress: string,
  requestId: string,
): Promise<{ events: AuditLogEntryPublic[]; total: number }> {
  if (!isAdmin) {
    throw new AuthError(
      'Admin access required',
      AuthErrorCodes.INSUFFICIENT_PERMISSIONS,
      403,
    );
  }

  const user = await repository.findUserById(targetUserId);
  if (!user) {
    throw new AuthError('User not found', AuthErrorCodes.USER_NOT_FOUND, 404);
  }

  const { rows, total } = await repository.listAuditLogsForUser(targetUserId, {
    limit: query.limit,
    offset: query.offset,
  });

  logAudit({
    user_id: adminId,
    org_id: null,
    action: 'admin.audit_logs_viewed',
    resource_type: 'user',
    resource_id: targetUserId,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { limit: query.limit, offset: query.offset },
  });

  return {
    events: rows.map((r) => ({
      id: r.id,
      action: r.action,
      resource_type: r.resource_type,
      resource_id: r.resource_id,
      org_id: r.org_id,
      ip_address: r.ip_address,
      created_at: r.created_at,
      metadata: r.metadata,
    })),
    total,
  };
}

export { getPasswordPolicy };

/**
 * Soft-delete accounts whose grace period has elapsed. Invoked by the auth
 * cleanup worker.
 */
export async function processDueAccountDeletions(): Promise<number> {
  const due = await repository.listUsersDueForDeletion();
  let processed = 0;

  for (const user of due) {
    await repository.withTransaction(async (client) => {
      await repository.softDeleteUser(
        user.id,
        'Scheduled account deletion',
        user.id,
        client,
      );
      await repository.revokeAllUserSessions(
        user.id,
        'Scheduled account deletion',
        client,
      );
    });
    cacheRevokeAllUserTokens(user.id);
    processed += 1;
    logAudit({
      user_id: user.id,
      org_id: null,
      action: 'user.deleted',
      resource_type: 'user',
      resource_id: user.id,
      ip_address: '127.0.0.1',
      request_id: 'scheduled-deletion-worker',
      metadata: { method: 'scheduled' },
    });
  }

  return processed;
}
