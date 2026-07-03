import { createHash } from 'crypto';
import secureSession from '@fastify/secure-session';
import { Authenticator } from '@fastify/passport';
import { Strategy as GitHubStrategy, } from 'passport-github2';
import { Strategy as GoogleStrategy, } from 'passport-google-oauth20';
import { env } from '../../config/env.js';
import { normalizeEmail } from './utils.js';
import { getApiSocialLoginCallbackUrl } from './oauth-callback.config.js';
export const socialPassport = new Authenticator();
function secureCookieEnabled() {
    return env.NODE_ENV !== 'development';
}
function sessionKey() {
    return createHash('sha256').update(env.COOKIE_SECRET).digest();
}
function toGoogleProfile(profile) {
    const email = profile.emails?.find((entry) => Boolean(entry.value))?.value ?? null;
    return {
        provider: 'google',
        subject: profile.id,
        email: email ? normalizeEmail(email) : null,
        displayName: profile.displayName || null,
        profileMetadata: {
            provider: profile.provider,
            name: profile.name,
            photos: profile.photos ?? [],
            emails: profile.emails ?? [],
        },
    };
}
function toGitHubProfile(profile) {
    const email = profile.emails?.find((entry) => Boolean(entry.value))?.value ?? null;
    return {
        provider: 'github',
        subject: profile.id,
        email: email ? normalizeEmail(email) : null,
        displayName: profile.displayName || profile.username || null,
        profileMetadata: {
            provider: profile.provider,
            username: profile.username ?? null,
            profileUrl: profile.profileUrl ?? null,
            photos: profile.photos ?? [],
            emails: profile.emails ?? [],
        },
    };
}
export async function registerPassportSocialAuth(fastify) {
    await fastify.register(secureSession, {
        key: sessionKey(),
        cookieName: 'passport_session',
        cookie: {
            path: '/',
            httpOnly: true,
            sameSite: secureCookieEnabled() ? 'none' : 'lax',
            secure: secureCookieEnabled(),
        },
    });
    await fastify.register(socialPassport.initialize());
    await fastify.register(socialPassport.secureSession());
    socialPassport.use('google', new GoogleStrategy({
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: getApiSocialLoginCallbackUrl(),
    }, (_accessToken, _refreshToken, profile, done) => {
        done(null, toGoogleProfile(profile));
    }));
    socialPassport.use('github', new GitHubStrategy({
        clientID: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        callbackURL: getApiSocialLoginCallbackUrl(),
        scope: ['read:user', 'user:email'],
    }, (_accessToken, _refreshToken, profile, done) => {
        done(null, toGitHubProfile(profile));
    }));
}
//# sourceMappingURL=passport-social.service.js.map