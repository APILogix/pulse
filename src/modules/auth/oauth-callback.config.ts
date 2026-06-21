/**
 * OAuth/OIDC redirect URIs — always target the API host (not the SPA).
 *
 * Register these exact URLs in Google, GitHub, Microsoft, and enterprise IdP consoles.
 */
import { env } from '../../config/env.js';

function apiBaseUrl(): string {
  return (process.env.API_PUBLIC_URL || env.APP_URL).replace(/\/+$/, '');
}

export function getApiOidcCallbackUrl(): string {
  return `${apiBaseUrl()}/auth/sso/callback`;
}

export function getApiSocialLoginCallbackUrl(): string {
  return `${apiBaseUrl()}/auth/login/social/callback`;
}

export function getApiIdentityLinkCallbackUrl(): string {
  return `${apiBaseUrl()}/auth/identity-providers/callback`;
}
