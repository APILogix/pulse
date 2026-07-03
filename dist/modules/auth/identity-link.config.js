/**
 * Shared social identity provider configuration.
 */
import { env } from '../../config/env.js';
const LINKABLE = ['google', 'github'];
export function isLinkableProvider(value) {
    return LINKABLE.includes(value);
}
export function isProviderConfigured(provider) {
    switch (provider) {
        case 'google':
            return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
        case 'github':
            return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
        default:
            return false;
    }
}
export function listConfiguredLinkProviders() {
    return LINKABLE.filter(isProviderConfigured);
}
//# sourceMappingURL=identity-link.config.js.map