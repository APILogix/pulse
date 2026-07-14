import { env } from '../../../config/env.js';
import { REFRESH_TOKEN_TTL_SECONDS } from '../domain/constants.js';
const SECURE_REFRESH_COOKIE_NAME = '__Host-refresh_token';
const DEV_REFRESH_COOKIE_NAME = 'refresh_token';
const LEGACY_REFRESH_COOKIE_NAMES = [SECURE_REFRESH_COOKIE_NAME, DEV_REFRESH_COOKIE_NAME, '_HOST_refresh_token'];
function useSecureRefreshCookiePrefix() {
    // Local deployments are sometimes run with NODE_ENV=production.  A Secure
    // cookie is ignored by browsers over http://localhost, which makes the
    // OAuth callback look like an expired session.  Tie the transport setting
    // to the public URL as well as the environment.
    return env.NODE_ENV !== 'development' && /^https:\/\//i.test(env.API_PUBLIC_URL || env.APP_URL);
}
export const REFRESH_COOKIE_NAME = useSecureRefreshCookiePrefix() ? SECURE_REFRESH_COOKIE_NAME : DEV_REFRESH_COOKIE_NAME;
export function getRefreshCookieNames() {
    return LEGACY_REFRESH_COOKIE_NAMES;
}
export function getRefreshCookieValue(cookies) {
    if (!cookies)
        return undefined;
    for (const name of LEGACY_REFRESH_COOKIE_NAMES) {
        const value = cookies[name];
        if (value)
            return value;
    }
    return undefined;
}
export function getRefreshCookieOptions(maxAgeSeconds) {
    const maxAge = (maxAgeSeconds ?? REFRESH_TOKEN_TTL_SECONDS) * 1000;
    const secure = useSecureRefreshCookiePrefix();
    return {
        httpOnly: true,
        secure,
        // The SPA and API are commonly different origins, and OAuth returns from
        // an external provider before the SPA calls the API. Strict would prevent
        // the refresh cookie from being sent in that cross-origin deployment.
        sameSite: secure ? 'none' : 'lax',
        maxAge, path: '/', signed: true,
    };
}
//# sourceMappingURL=cookies.js.map