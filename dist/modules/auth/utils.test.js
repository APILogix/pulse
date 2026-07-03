import { afterEach, describe, expect, it, vi } from 'vitest';
const ORIGINAL_ENV = process.env.NODE_ENV;
afterEach(() => {
    process.env.NODE_ENV = ORIGINAL_ENV;
    vi.resetModules();
});
describe('refresh cookie utils', () => {
    it('uses a dev-safe cookie name and same-site policy on plain HTTP', async () => {
        process.env.NODE_ENV = 'development';
        const { REFRESH_COOKIE_NAME, getRefreshCookieOptions } = await import('./utils.js');
        expect(REFRESH_COOKIE_NAME).toBe('refresh_token');
        expect(getRefreshCookieOptions()).toMatchObject({
            secure: false,
            sameSite: 'lax',
            path: '/',
            signed: true,
            httpOnly: true,
        });
    });
    it('uses the __Host- cookie name when secure transport is enabled', async () => {
        process.env.NODE_ENV = 'production';
        const { REFRESH_COOKIE_NAME, getRefreshCookieOptions } = await import('./utils.js');
        expect(REFRESH_COOKIE_NAME).toBe('__Host-refresh_token');
        expect(getRefreshCookieOptions()).toMatchObject({
            secure: true,
            sameSite: 'none',
            path: '/',
            signed: true,
            httpOnly: true,
        });
    });
    it('accepts legacy refresh cookie names during refresh', async () => {
        process.env.NODE_ENV = 'development';
        const { getRefreshCookieValue } = await import('./utils.js');
        expect(getRefreshCookieValue({ _HOST_refresh_token: 'a' })).toBe('a');
        expect(getRefreshCookieValue({ '__Host-refresh_token': 'b' })).toBe('b');
        expect(getRefreshCookieValue({ refresh_token: 'c' })).toBe('c');
    });
});
describe('session device labels', () => {
    it('reduces a Windows browser user agent to a clean desktop label', async () => {
        const { buildSessionDeviceLabel } = await import('../../shared/utils/request.js');
        expect(buildSessionDeviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36', 'desktop')).toBe('Windows PC');
    });
    it('reduces an iPhone user agent to a clean mobile label', async () => {
        const { buildSessionDeviceLabel } = await import('../../shared/utils/request.js');
        expect(buildSessionDeviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1', 'mobile')).toBe('iPhone');
    });
});
//# sourceMappingURL=utils.test.js.map