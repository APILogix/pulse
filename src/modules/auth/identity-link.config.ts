/**
 * OAuth client configuration for social account linking (env-driven).
 */
import { env } from '../../config/env.js';

export type LinkableProvider = 'google' | 'github' | 'microsoft';

const LINKABLE: LinkableProvider[] = ['google', 'github', 'microsoft'];

export function getIdentityLinkCallbackUrl(): string {
  const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
  return `${base}/auth/identity-providers/callback`;
}

export { getApiIdentityLinkCallbackUrl } from './oauth-callback.config.js';

export function isLinkableProvider(value: string): value is LinkableProvider {
  return (LINKABLE as string[]).includes(value);
}

export function isProviderConfigured(provider: LinkableProvider): boolean {
  switch (provider) {
    case 'google':
      return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    case 'github':
      return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
    case 'microsoft':
      return Boolean(
        process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET,
      );
    default:
      return false;
  }
}

export function listConfiguredLinkProviders(): LinkableProvider[] {
  return LINKABLE.filter(isProviderConfigured);
}

export function getMicrosoftIssuer(): string {
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  return `https://login.microsoftonline.com/${tenant}/v2.0`;
}
