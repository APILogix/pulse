/**
 * Shared SSO user resolution (OIDC + SAML): lookup, JIT provision, domain policy.
 */
import { createHash, randomUUID } from 'crypto';

import { logAudit } from '../../../../shared/middleware/audit-logger.js';

import * as repository from '../../infrastructure/repositories/index.js';
import { AuthError, AuthErrorCodes, type User } from '../../domain/types.js';
import { normalizeEmail } from '../../domain/constants.js';

export interface SsoProvisionProvider {
  id: string;
  org_id: string;
  domain: string | null;
  oidc_jit_provision: boolean;
  oidc_jit_default_role: string;
}

function emailToHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

export function extractEmailFromSamlProfile(
  profile: Record<string, unknown>,
): string | null {
  const candidates = [
    profile.email,
    profile.mail,
    profile.nameID,
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.includes('@')) {
      return normalizeEmail(value);
    }
  }
  return null;
}

export function extractDisplayNameFromSamlProfile(
  profile: Record<string, unknown>,
  email: string,
): string {
  const candidates = [
    profile.displayName,
    profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
    profile.firstName,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return email.split('@')[0] ?? 'User';
}

/**
 * Resolve an SSO user by email. JIT-provisions when enabled on the org provider.
 */
export async function resolveSsoUser(
  email: string,
  displayName: string | undefined,
  provider: SsoProvisionProvider,
  ipAddress: string,
  requestId: string,
  auditAction: 'user.sso_jit_provisioned' | 'user.saml_jit_provisioned',
): Promise<User> {
  const normalized = normalizeEmail(email);
  const existing = await repository.findUserByEmailHash(emailToHash(normalized));
  if (existing) {
    return existing;
  }

  if (!provider.oidc_jit_provision) {
    throw new AuthError(
      'No account exists for this identity. Contact your administrator.',
      AuthErrorCodes.JIT_PROVISIONING_DISABLED,
      403,
    );
  }

  const emailDomain = normalized.split('@')[1]?.toLowerCase();
  if (
    provider.domain &&
    emailDomain &&
    provider.domain.trim().toLowerCase() !== emailDomain
  ) {
    throw new AuthError(
      'Email domain does not match organization SSO policy',
      AuthErrorCodes.SSO_DOMAIN_MISMATCH,
      403,
    );
  }

  const fullName = displayName?.trim() || normalized.split('@')[0] || 'User';
  const role = provider.oidc_jit_default_role || 'member';

  const user = await repository.withTransaction(async (client) => {
    const created = await repository.createSsoJitUser(
      { id: randomUUID(), email: normalized, full_name: fullName },
      client,
    );
    await repository.addOrgMemberSsoProvision(
      provider.org_id,
      created.id,
      role,
      client,
    );
    return created;
  });

  logAudit({
    user_id: user.id,
    org_id: provider.org_id,
    action: auditAction,
    resource_type: 'user',
    resource_id: user.id,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { provider_id: provider.id, role },
  });

  return user;
}
