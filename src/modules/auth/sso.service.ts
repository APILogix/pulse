/**

 * OIDC SSO login (authorization code + PKCE).

 *

 * State is stored in-process (LRU). Provider secrets and OIDC metadata live

 * in Postgres (`organization_sso_providers`).

 */

import { createHash } from 'crypto';

import {

  authorizationCodeGrant,

  buildAuthorizationUrl,

  calculatePKCECodeChallenge,

  ClientSecretPost,

  discovery,

  randomNonce,

  randomPKCECodeVerifier,

  randomState,

} from 'openid-client';



import { env as config } from '../../config/env.js';

import { decrypt } from '../../shared/utils/encryption.js';

import { logAudit } from '../../shared/middleware/audit-logger.js';



import { oidcLoginStateCache, type OidcLoginState } from './cache.js';

import * as repository from './repository.js';
import * as saml from './saml.service.js';
import { resolveSsoUser } from './sso-provision.service.js';
import { finalizeEnterpriseSsoLogin } from './sso-session.service.js';
import {
  AuthError,
  AuthErrorCodes,
  type SsoLoginInput,
} from './types.js';

import { getApiOidcCallbackUrl } from './oauth-callback.config.js';
import { normalizeEmail } from './utils.js';

function emailToHash(email: string): string {
  return createHash('sha256').update(normalizeEmail(email)).digest('hex');
}

function getCallbackUrl(): string {
  return getApiOidcCallbackUrl();
}



async function buildOidcConfig(provider: repository.OidcProviderRow) {

  const clientSecret = decrypt(

    provider.oidc_client_secret_encrypted,

    config.ENCRYPTION_KEY,

  );

  return discovery(

    new URL(provider.oidc_issuer),

    provider.oidc_client_id,

    clientSecret,

    ClientSecretPost(clientSecret),

  );

}

/**
 * Unified SSO login entry: routes to OIDC or SAML based on provider_type.
 */
export async function startSsoLogin(
  input: SsoLoginInput,
  ipAddress: string,
  userAgent: string,
  requestId: string,
): Promise<{ authorization_url: string; state: string }> {
  if (input.provider_id) {
    const ref = await repository.findSsoProviderRef(input.provider_id);
    if (!ref) {
      throw new AuthError(
        'SSO provider not found',
        AuthErrorCodes.SSO_NOT_CONFIGURED,
        404,
      );
    }
    if (ref.provider_type === 'saml') {
      return saml.startSamlLogin(input, ipAddress, userAgent, requestId);
    }
    return startOidcLogin(input, ipAddress, userAgent, requestId);
  }

  if (input.email) {
    const domain = normalizeEmail(input.email).split('@')[1];
    if (domain) {
      const samlProvider = await repository.findSamlProviderForEmailDomain(domain);
      if (samlProvider) {
        return saml.startSamlLogin(input, ipAddress, userAgent, requestId);
      }
    }
  }

  return startOidcLogin(input, ipAddress, userAgent, requestId);
}

async function startOidcLogin(

  input: SsoLoginInput,

  ipAddress: string,

  userAgent: string,

  requestId: string,

): Promise<{ authorization_url: string; state: string }> {

  let provider: repository.OidcProviderRow | null = null;



  if (input.provider_id) {

    provider = await repository.findOidcProviderById(input.provider_id);

  } else if (input.email) {

    const domain = normalizeEmail(input.email).split('@')[1];

    if (domain) {

      provider = await repository.findOidcProviderForEmailDomain(domain);

    }

  }



  if (!provider) {

    throw new AuthError(

      'No OIDC provider configured for this request',

      AuthErrorCodes.OIDC_NOT_CONFIGURED,

      404,

    );

  }



  const oidcConfig = await buildOidcConfig(provider);

  const codeVerifier = randomPKCECodeVerifier();

  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);

  const state = randomState();

  const nonce = randomNonce();

  const redirectUri = getCallbackUrl();



  const url = buildAuthorizationUrl(oidcConfig, {

    redirect_uri: redirectUri,

    scope: provider.oidc_scopes || 'openid email profile',

    code_challenge: codeChallenge,

    code_challenge_method: 'S256',

    state,

    nonce,

  });



  const payload: OidcLoginState = {

    providerId: provider.id,

    orgId: provider.org_id,

    codeVerifier,

    nonce,

    redirectUri,

    rememberMe: input.remember_me === true,

    ipAddress,

    userAgent,

    ...(input.device_name !== undefined ? { deviceName: input.device_name } : {}),

    ...(input.device_type !== undefined
      ? { clientDeviceType: input.device_type }
      : {}),

  };

  oidcLoginStateCache.set(state, payload);



  logAudit({

    user_id: null,

    org_id: provider.org_id,

    action: 'sso.login_started',

    resource_type: 'sso_provider',

    resource_id: provider.id,

    ip_address: ipAddress,

    request_id: requestId,

    user_agent: userAgent,

  });



  return { authorization_url: url.toString(), state };

}



export async function completeSsoCallback(

  callbackUrl: string,

  ipAddress: string,

  userAgent: string,

  requestId: string,

): Promise<{

  access_token: string;

  refresh_token: string;

  expires_at: Date;

  token_type: 'Bearer';

  session_id: string;

  user_id: string;

}> {

  const url = new URL(callbackUrl);

  const state = url.searchParams.get('state');

  if (!state) {

    throw new AuthError('Missing state', AuthErrorCodes.OIDC_CALLBACK_INVALID, 400);

  }



  const flow = oidcLoginStateCache.get(state);

  if (!flow) {

    throw new AuthError(

      'SSO session expired; restart sign-in',

      AuthErrorCodes.OIDC_CALLBACK_INVALID,

      400,

    );

  }

  oidcLoginStateCache.delete(state);



  const provider = await repository.findOidcProviderById(flow.providerId);

  if (!provider) {

    throw new AuthError(

      'SSO provider not found',

      AuthErrorCodes.OIDC_NOT_CONFIGURED,

      404,

    );

  }



  const oidcConfig = await buildOidcConfig(provider);

  const tokens = await authorizationCodeGrant(oidcConfig, url, {

    expectedNonce: flow.nonce,

    expectedState: state,

    pkceCodeVerifier: flow.codeVerifier,

  });



  const claims = tokens.claims();

  const email =

    typeof claims?.email === 'string' ? normalizeEmail(claims.email) : null;

  if (!email) {

    throw new AuthError(

      'Identity provider did not return an email',

      AuthErrorCodes.OIDC_CALLBACK_INVALID,

      400,

    );

  }



  const displayName =
    typeof claims?.name === 'string'
      ? claims.name
      : typeof claims?.given_name === 'string'
        ? claims.given_name
        : undefined;

  const user = await resolveSsoUser(
    email,
    displayName,
    provider,
    ipAddress,
    requestId,
    'user.sso_jit_provisioned',
  );

  return finalizeEnterpriseSsoLogin({
    user,
    provider,
    flow,
    ipAddress,
    userAgent,
    requestId,
    method: 'oidc',
  });
}


