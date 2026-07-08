/**
 * Finalize SSO login: org policy check, session issuance, audit.
 */
import { logAudit } from '../../../../shared/middleware/audit-logger.js';

import * as repository from '../../infrastructure/repositories/index.js';
import { assertLoginAllowedByOrgPolicy } from '../../domain/policies.js';
import { issueSessionForUser, type SessionSsoContext } from './index.js';
import type { User } from '../../domain/types.js';

export interface SsoLoginFlowContext {
  providerId: string;
  orgId: string;
  rememberMe: boolean;
  ipAddress: string;
  userAgent: string;
  deviceName?: string;
  clientDeviceType?: string;
}

export async function finalizeEnterpriseSsoLogin(options: {
  user: User;
  provider: { id: string; org_id: string };
  flow: SsoLoginFlowContext;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  method: 'oidc' | 'saml';
  samlNameId?: string;
  samlSessionIndex?: string;
}): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: Date;
  token_type: 'Bearer';
  session_id: string;
  user_id: string;
}> {
  await assertLoginAllowedByOrgPolicy(options.user);

  const ssoContext: SessionSsoContext = {
    providerId: options.provider.id,
    providerType: options.method,
    loginMethod: options.method,
    ...(options.samlNameId !== undefined ? { samlNameId: options.samlNameId } : {}),
    ...(options.samlSessionIndex !== undefined
      ? { samlSessionIndex: options.samlSessionIndex }
      : {}),
  };

  const session = await issueSessionForUser({
    user: options.user,
    ipAddress: options.flow.ipAddress || options.ipAddress,
    userAgent: options.flow.userAgent || options.userAgent,
    deviceName: options.flow.deviceName,
    deviceType: options.flow.clientDeviceType,
    mfaVerified: true,
    rememberMe: options.flow.rememberMe,
    ssoContext,
  });

  await repository.recordLogin(options.user.id, options.ipAddress, options.userAgent);

  logAudit({
    user_id: options.user.id,
    org_id: options.provider.org_id,
    action: options.method === 'saml' ? 'user.login_saml' : 'user.login_sso',
    resource_type: 'user',
    resource_id: options.user.id,
    ip_address: options.ipAddress,
    user_agent: options.userAgent,
    request_id: options.requestId,
    metadata: {
      provider_id: options.provider.id,
      session_id: session.sessionId,
      method: options.method,
    },
  });

  return {
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
    expires_at: session.expiresAt,
    token_type: 'Bearer',
    session_id: session.sessionId,
    user_id: options.user.id,
  };
}
