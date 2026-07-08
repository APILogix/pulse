import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
const ORIGINAL_ENV = { ...process.env };
function applyRequiredEnv() {
    process.env.NODE_ENV = 'development';
    process.env.DATABASE_URL ??= 'postgres://postgres:postgres@localhost:5432/pulse_test';
    process.env.REDIS_URL ??= 'redis://localhost:6379';
    process.env.JWT_SECRET ??= 'a'.repeat(32);
    process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(32);
    process.env.COOKIE_SECRET ??= 'c'.repeat(32);
    process.env.ENCRYPTION_KEY ??= 'd'.repeat(32);
    process.env.APP_URL ??= 'http://localhost:5173';
}
afterEach(() => {
    for (const key of Object.keys(process.env)) {
        if (!(key in ORIGINAL_ENV)) {
            delete process.env[key];
        }
    }
    Object.assign(process.env, ORIGINAL_ENV);
    vi.resetModules();
});
describe('auth route registration', () => {
    it('registers user-managed identity provider routes', async () => {
        applyRequiredEnv();
        process.env.GOOGLE_CLIENT_ID ??= 'google-client-id';
        process.env.GOOGLE_CLIENT_SECRET ??= 'google-client-secret';
        process.env.GITHUB_CLIENT_ID ??= 'github-client-id';
        process.env.GITHUB_CLIENT_SECRET ??= 'github-client-secret';
        const { registerAuthModule } = await import('../../auth.module.js');
        const app = Fastify();
        try {
            await app.register(registerAuthModule);
            const linkResponse = await app.inject({
                method: 'POST',
                url: '/auth/identity-providers/google/link',
            });
            const listResponse = await app.inject({
                method: 'GET',
                url: '/auth/identity-providers',
            });
            const unlinkResponse = await app.inject({
                method: 'DELETE',
                url: '/auth/identity-providers/test-link-id',
            });
            const callbackResponse = await app.inject({
                method: 'GET',
                url: '/auth/login/social/callback?code=x&state=y',
            });
            const emailChangeRequestResponse = await app.inject({
                method: 'POST',
                url: '/auth/email/change/request',
            });
            const emailChangeConfirmResponse = await app.inject({
                method: 'POST',
                url: '/auth/email/change/confirm',
            });
            expect(linkResponse.statusCode).not.toBe(404);
            expect(listResponse.statusCode).not.toBe(404);
            expect(unlinkResponse.statusCode).not.toBe(404);
            expect(callbackResponse.statusCode).not.toBe(404);
            expect(emailChangeRequestResponse.statusCode).toBe(404);
            expect(emailChangeConfirmResponse.statusCode).toBe(404);
        }
        finally {
            await app.close();
        }
    }, 45000);
});
//# sourceMappingURL=route-registration.test.js.map