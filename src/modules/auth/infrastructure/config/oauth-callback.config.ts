/**
 * OAuth/OIDC redirect URIs — always target the API host (not the SPA).
 *
 * Register these exact URLs in Google, GitHub, Microsoft, and enterprise IdP consoles.
 */
import { env } from '../../../../config/env.js';
import type { LinkableProvider } from '../config/identity-link.config.js';

export function apiBaseUrl(): string {
  return (env.API_PUBLIC_URL || env.APP_URL).replace(/\/+$/, '');
}

export function getApiOidcCallbackUrl(): string {
  return env.OIDC_CALLBACK_URL || `${apiBaseUrl()}/auth/sso/callback`;
}

export function getApiSocialLoginCallbackUrl(): string {
  return env.SOCIAL_LOGIN_CALLBACK_URL || `${apiBaseUrl()}/auth/login/social/callback`;
}

export function getApiProviderAuthorizeUrl(
  provider: LinkableProvider,
  flow: 'login' | 'link',
): string {
  return flow === 'login'
    ? `${apiBaseUrl()}/auth/login/social/${provider}/authorize`
    : `${apiBaseUrl()}/auth/identity-providers/${provider}/authorize`;
}

export function buildConfiguredCallbackUrl(
  redirectUri: string,
  requestUrl: string,
): string {
  const callbackUrl = new URL(redirectUri);
  const incomingUrl = requestUrl.startsWith('http')
    ? new URL(requestUrl)
    : new URL(requestUrl, redirectUri);

  callbackUrl.search = incomingUrl.search;
  return callbackUrl.toString();
}
