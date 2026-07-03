/**
 * Shared social identity provider configuration.
 */
import { env } from '../../config/env.js';

export type LinkableProvider = 'google' | 'github';

const LINKABLE: LinkableProvider[] = ['google', 'github'];

export function isLinkableProvider(value: string): value is LinkableProvider {
  return (LINKABLE as string[]).includes(value);
}

export function isProviderConfigured(provider: LinkableProvider): boolean {
  switch (provider) {
    case 'google':
      return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
    case 'github':
      return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
    default:
      return false;
  }
}

export function listConfiguredLinkProviders(): LinkableProvider[] {
  return LINKABLE.filter(isProviderConfigured);
}
