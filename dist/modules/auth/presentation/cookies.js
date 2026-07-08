import { env } from '../../../config/env.js';
import { REFRESH_TOKEN_TTL_SECONDS } from '../domain/constants.js';
const SECURE_REFRESH_COOKIE_NAME = '__Host-refresh_token';
const DEV_REFRESH_COOKIE_NAME = 'refresh_token';
const LEGACY_REFRESH_COOKIE_NAMES = [SECURE_REFRESH_COOKIE_NAME, DEV_REFRESH_COOKIE_NAME, '_HOST_refresh_token'];
function useSecureRefreshCookiePrefix() {
    return env.NODE_ENV !== 'development';
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
        httpOnly: true, secure, sameSite: 'strict',
        maxAge, path: '/', signed: true,
    };
}
//# sourceMappingURL=cookies.js.map