/**
 * OAuth account linking for Google, GitHub, and Microsoft (enterprise opt-in via env).
 *
 * Requires an authenticated session + step-up before starting a link flow.
 * Does not replace org SAML/OIDC SSO — only binds social identities to existing users.
 */
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  discovery,
  randomNonce,
  randomPKCECodeVerifier,
  randomState,
} from 'openid-client';

import { env as config } from '../../config/env.js';
import { logAudit } from '../../shared/middleware/audit-logger.js';

import { identityLinkStateCache } from './cache.js';
import {
  getApiIdentityLinkCallbackUrl,
  getMicrosoftIssuer,
  isLinkableProvider,
  isProviderConfigured,
  type LinkableProvider,
} from './identity-link.config.js';
import * as repository from './repository.js';
import { AuthError, AuthErrorCodes } from './types.js';
import { normalizeEmail } from './utils.js';

function assertProviderConfigured(provider: LinkableProvider): void {
  if (!isProviderConfigured(provider)) {
    throw new AuthError(
      `${provider} account linking is not configured on this deployment`,
      AuthErrorCodes.IDENTITY_PROVIDER_NOT_CONFIGURED,
      503,
    );
  }
}

async function buildOidcLinkConfig(provider: 'google' | 'microsoft') {
  const clientId =
    provider === 'google'
      ? config.GOOGLE_CLIENT_ID!
      : config.MICROSOFT_CLIENT_ID!;
  const clientSecret =
    provider === 'google'
      ? config.GOOGLE_CLIENT_SECRET!
      : config.MICROSOFT_CLIENT_SECRET!;
  const issuer =
    provider === 'google'
      ? 'https://accounts.google.com'
      : getMicrosoftIssuer();

  return discovery(new URL(issuer), clientId, clientSecret);
}

export async function startIdentityLink(
  userId: string,
  provider: string,
  ipAddress: string,
  requestId: string,
): Promise<{ authorization_url: string; state: string }> {
  if (!isLinkableProvider(provider)) {
    throw new AuthError('Unsupported provider', AuthErrorCodes.VALIDATION_ERROR, 400);
  }
  assertProviderConfigured(provider);

  const existing = await repository.findLinkedIdentityByUserProvider(userId, provider);
  if (existing) {
    throw new AuthError(
      `${provider} is already linked to this account`,
      AuthErrorCodes.IDENTITY_ALREADY_LINKED,
      409,
    );
  }

  const redirectUri = getApiIdentityLinkCallbackUrl();
  const state = randomState();
  const codeVerifier = randomPKCECodeVerifier();
  const nonce = provider === 'github' ? undefined : randomNonce();

  let authorizationUrl: string;

  if (provider === 'github') {
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const params = new URLSearchParams({
      client_id: config.GITHUB_CLIENT_ID!,
      redirect_uri: redirectUri,
      scope: 'read:user user:email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    authorizationUrl = `https://github.com/login/oauth/authorize?${params.toString()}`;
  } else {
    const oidcConfig = await buildOidcLinkConfig(provider);
    const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
    const url = buildAuthorizationUrl(oidcConfig, {
      redirect_uri: redirectUri,
      scope: provider === 'google' ? 'openid email profile' : 'openid email profile User.Read',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      state,
      ...(nonce ? { nonce } : {}),
    });
    authorizationUrl = url.toString();
  }

  identityLinkStateCache.set(state, {
    userId,
    provider,
    codeVerifier,
    redirectUri,
    ...(nonce ? { nonce } : {}),
  });

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.identity_link_started',
    resource_type: 'identity_provider',
    resource_id: provider,
    ip_address: ipAddress,
    request_id: requestId,
  });

  return { authorization_url: authorizationUrl, state };
}

async function exchangeGithubCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ sub: string; email: string | null }> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      client_id: config.GITHUB_CLIENT_ID,
      client_secret: config.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    }),
  });
  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenJson.access_token) {
    throw new AuthError(
      tokenJson.error || 'GitHub token exchange failed',
      AuthErrorCodes.IDENTITY_LINK_FAILED,
      400,
    );
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': config.APP_NAME,
    },
  });
  const userJson = (await userRes.json()) as { id?: number; email?: string | null };
  if (!userJson.id) {
    throw new AuthError('GitHub profile missing', AuthErrorCodes.IDENTITY_LINK_FAILED, 400);
  }

  let email = userJson.email ?? null;
  if (!email) {
    const emailsRes = await fetch('https://api.github.com/user/emails', {
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': config.APP_NAME,
      },
    });
    const emails = (await emailsRes.json()) as Array<{
      email: string;
      primary: boolean;
      verified: boolean;
    }>;
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    email = primary?.email ?? null;
  }

  return { sub: String(userJson.id), email };
}

export async function completeIdentityLink(
  callbackUrl: string,
  ipAddress: string,
  requestId: string,
): Promise<{ provider: LinkableProvider; linked: true }> {
  const url = new URL(callbackUrl);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code) {
    throw new AuthError(
      'Missing state or authorization code',
      AuthErrorCodes.IDENTITY_LINK_FAILED,
      400,
    );
  }

  const flow = identityLinkStateCache.get(state);
  if (!flow) {
    throw new AuthError(
      'Link session expired; start again from account settings',
      AuthErrorCodes.IDENTITY_LINK_FAILED,
      400,
    );
  }
  identityLinkStateCache.delete(state);

  let providerSubject: string;
  let providerEmail: string | null;

  if (flow.provider === 'github') {
    const profile = await exchangeGithubCode(code, flow.codeVerifier, flow.redirectUri);
    providerSubject = profile.sub;
    providerEmail = profile.email;
  } else {
    const oidcConfig = await buildOidcLinkConfig(flow.provider);
    const tokens = await authorizationCodeGrant(oidcConfig, url, {
      ...(flow.nonce ? { expectedNonce: flow.nonce } : {}),
      expectedState: state,
      pkceCodeVerifier: flow.codeVerifier,
    });
    const claims = tokens.claims();
    providerSubject =
      typeof claims?.sub === 'string' ? claims.sub : '';
    providerEmail =
      typeof claims?.email === 'string' ? normalizeEmail(claims.email) : null;
    if (!providerSubject) {
      throw new AuthError(
        'Provider did not return a subject',
        AuthErrorCodes.IDENTITY_LINK_FAILED,
        400,
      );
    }
  }

  const collision = await repository.findLinkedIdentityByProviderSubject(
    flow.provider,
    providerSubject,
  );
  if (collision && collision.user_id !== flow.userId) {
    throw new AuthError(
      'This external account is already linked to another user',
      AuthErrorCodes.IDENTITY_ALREADY_LINKED,
      409,
    );
  }

  await repository.createLinkedIdentity({
    user_id: flow.userId,
    provider: flow.provider,
    provider_subject: providerSubject,
    provider_email: providerEmail,
    profile_metadata: { email: providerEmail },
  });

  logAudit({
    user_id: flow.userId,
    org_id: null,
    action: 'user.identity_linked',
    resource_type: 'identity_provider',
    resource_id: flow.provider,
    ip_address: ipAddress,
    request_id: requestId,
    metadata: { provider_subject: providerSubject },
  });

  return { provider: flow.provider, linked: true };
}

export async function listUserLinkedIdentities(userId: string) {
  const rows = await repository.listLinkedIdentities(userId);
  return rows.map((r) => ({
    id: r.id,
    provider: r.provider,
    provider_email: r.provider_email,
    linked_at: r.linked_at,
    last_used_at: r.last_used_at,
  }));
}

export async function unlinkIdentity(
  userId: string,
  linkId: string,
  ipAddress: string,
  requestId: string,
): Promise<void> {
  const ok = await repository.revokeLinkedIdentity(userId, linkId);
  if (!ok) {
    throw new AuthError('Linked identity not found', AuthErrorCodes.VALIDATION_ERROR, 404);
  }

  logAudit({
    user_id: userId,
    org_id: null,
    action: 'user.identity_unlinked',
    resource_type: 'identity_provider',
    resource_id: linkId,
    ip_address: ipAddress,
    request_id: requestId,
  });
}
