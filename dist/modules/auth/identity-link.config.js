/**
 * OAuth client configuration for social account linking (env-driven).
 */
import { env } from '../../config/env.js';
const LINKABLE = ['google', 'github', 'microsoft'];
export function getIdentityLinkCallbackUrl() {
    const base = (env.FRONTEND_URL || env.APP_URL).replace(/\/+$/, '');
    return `${base}/auth/identity-providers/callback`;
}
export { getApiIdentityLinkCallbackUrl } from './oauth-callback.config.js';
export function isLinkableProvider(value) {
    return LINKABLE.includes(value);
}
export function isProviderConfigured(provider) {
    switch (provider) {
        case 'google':
            return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
        case 'github':
            return Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET);
        case 'microsoft':
            return Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
        default:
            return false;
    }
}
export function listConfiguredLinkProviders() {
    return LINKABLE.filter(isProviderConfigured);
}
export function getMicrosoftIssuer() {
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
    return `https://login.microsoftonline.com/${tenant}/v2.0`;
}
//# sourceMappingURL=identity-link.config.js.map