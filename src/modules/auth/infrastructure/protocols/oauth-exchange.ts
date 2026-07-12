/**
 * Shared OAuth token exchange for social login and related provider callbacks.
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

import { env as config } from '../../../../config/env.js';
import {
  type LinkableProvider,
} from '../config/identity-link.config.js';
import { AuthError, AuthErrorCodes } from '../../domain/types.js';
import { normalizeEmail } from '../../domain/constants.js';

export interface OAuthProfile {
  provider: LinkableProvider;
  subject: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export async function buildOidcClient(provider: 'google') {
  return discovery(
    new URL('https://accounts.google.com'),
    config.GOOGLE_CLIENT_ID!,
    config.GOOGLE_CLIENT_SECRET!,
  );
}

export async function buildOAuthAuthorizationUrl(options: {
  provider: LinkableProvider;
  redirectUri: string;
  state: string;
  codeVerifier: string;
  nonce?: string;
}): Promise<string> {
  if (options.provider === 'github') {
    const codeChallenge = await calculatePKCECodeChallenge(options.codeVerifier);
    const params = new URLSearchParams({
      client_id: config.GITHUB_CLIENT_ID!,
      redirect_uri: options.redirectUri,
      scope: 'read:user user:email',
      state: options.state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://github.com/login/oauth/authorize?${params.toString()}`;
  }

  const oidcConfig = await buildOidcClient(options.provider);
  const codeChallenge = await calculatePKCECodeChallenge(options.codeVerifier);
  const url = buildAuthorizationUrl(oidcConfig, {
    redirect_uri: options.redirectUri,
    scope:
      options.provider === 'google'
        ? 'openid email profile'
        : 'read:user user:email',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: options.state,
    ...(options.nonce ? { nonce: options.nonce } : {}),
  });
  return url.toString();
}

async function exchangeGithubCode(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<OAuthProfile> {
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
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
  const userJson = (await userRes.json()) as {
    id?: number;
    email?: string | null;
    name?: string | null;
    login?: string;
    avatar_url?: string | null;
  };
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
    const primary =
      emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    email = primary?.email ?? null;
  }

  return {
    provider: 'github',
    subject: String(userJson.id),
    email,
    displayName: userJson.name ?? userJson.login ?? null,
    avatarUrl: userJson.avatar_url ?? null,
  };
}

export async function exchangeOAuthCallback(
  provider: LinkableProvider,
  callbackUrl: string,
  codeVerifier: string,
  redirectUri: string,
  nonce?: string,
): Promise<OAuthProfile> {
  const url = new URL(callbackUrl);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    throw new AuthError(
      'Missing authorization code',
      AuthErrorCodes.IDENTITY_LINK_FAILED,
      400,
    );
  }

  if (provider === 'github') {
    return exchangeGithubCode(code, codeVerifier, redirectUri);
  }

  const oidcConfig = await buildOidcClient(provider);
  const tokens = await authorizationCodeGrant(oidcConfig, url, {
    ...(nonce ? { expectedNonce: nonce } : {}),
    expectedState: state,
    pkceCodeVerifier: codeVerifier,
  });
  const claims = tokens.claims();
  const subject = typeof claims?.sub === 'string' ? claims.sub : '';
  if (!subject) {
    throw new AuthError(
      'Provider did not return a subject',
      AuthErrorCodes.IDENTITY_LINK_FAILED,
      400,
    );
  }
  const email =
    typeof claims?.email === 'string' ? normalizeEmail(claims.email) : null;
  const displayName =
    typeof claims?.name === 'string'
      ? claims.name
      : typeof claims?.given_name === 'string'
        ? claims.given_name
        : null;
  const avatarUrl = typeof claims?.picture === 'string' ? claims.picture : null;

  return { provider, subject, email, displayName, avatarUrl };
}

export function createPkcePair(): {
  codeVerifier: string;
  state: string;
  nonce: string;
} {
  return {
    codeVerifier: randomPKCECodeVerifier(),
    state: randomState(),
    nonce: randomNonce(),
  };
}
