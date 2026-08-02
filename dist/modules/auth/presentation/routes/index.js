import { authenticate, requireAdmin, requireStepUp, } from '../../../../shared/middleware/auth.js';
import { getClientInfo } from '../../../../shared/utils/request.js';
import * as service from '../../application/services/index.js';
import { AuthError, AdminLockUserSchema, AuthErrorCodes, BackupCodeLoginSchema, ChangePasswordSchema, CreateUserSchema, DeleteUserSchema, ForgotPasswordSchema, ListUsersQuerySchema, LoginMFAVerifySchema, LoginSchema, MFADeviceRemoveSchema, MFADisableRequestSchema, MFASetupSchema, MFAToggleSchema, MFAVerifySchema, MFAVerifySetupSchema, EmailMfaResendSchema, RegenerateBackupCodesSchema, ResendVerificationSchema, ResetPasswordSchema, SuspendUserSchema, UpdateUserSchema, VerifyEmailConfirmSchema, VerifyEmailQuerySchema, } from '../../domain/types.js';
import identityRoutes from './identity.routes.js';
import ssoOidcRoutes from './sso-oidc.routes.js';
import { OrganizationRepository } from '../../../organization/repository.js';
import * as authRepo from '../../infrastructure/repositories/index.js';
import accountAdministrationRoutes from './account-administration.routes.js';
import samlIdentityRoutes from './saml-identity.routes.js';
import provisioningRoutes from './provisioning.routes.js';
import { forgotPasswordRateLimit, loginMfaRateLimit, loginRateLimit, mfaEmailResendRateLimit, refreshSessionRateLimit, registerRateLimit, resendVerificationRateLimit, resetPasswordRateLimit, tokenConfirmRateLimit, verifyEmailRateLimit, } from '../middleware/rate-limits.js';
import { getRefreshCookieNames, getRefreshCookieOptions, getRefreshCookieValue, REFRESH_COOKIE_NAME, } from '../cookies.js';
function clearRefreshCookies(reply) {
    const options = getRefreshCookieOptions();
    for (const name of getRefreshCookieNames()) {
        reply.clearCookie(name, options);
    }
}
// ============================================================================
// ERROR HANDLER
// ============================================================================
export function handleAuthError(error, reply, request) {
    if (error instanceof AuthError) {
        return reply.status(error.statusCode).send({
            error: {
                code: error.code,
                message: error.message,
                details: error.details,
            },
        });
    }
    const err = error;
    if (err?.name === 'ZodError') {
        return reply.status(400).send({
            error: {
                code: AuthErrorCodes.VALIDATION_ERROR,
                message: 'Invalid request payload',
                details: { issues: err.issues },
            },
        });
    }
    request.log.error({ err: error }, 'Unexpected auth error');
    return reply.status(500).send({
        error: {
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred',
        },
    });
}
async function sendAuthSession(reply, payload) {
    const maxAgeSeconds = Math.max(0, Math.ceil((payload.expires_at.getTime() - Date.now()) / 1000));
    reply.setCookie(REFRESH_COOKIE_NAME, payload.refresh_token, getRefreshCookieOptions(maxAgeSeconds));
    if (payload.user_id) {
        const user = await authRepo.findUserById(payload.user_id);
        const orgRepo = new OrganizationRepository();
        const orgContext = await orgRepo.getUserContextForLogin(payload.user_id);
        return reply.send({
            data: {
                access_token: payload.access_token,
                expires_at: payload.expires_at,
                token_type: payload.token_type,
                session_id: payload.session_id,
                user: user ? {
                    id: user.id,
                    email: user.email,
                    name: user.full_name,
                } : undefined,
                default_org_slug: orgContext.default_org_slug,
                organizations: orgContext.organizations,
            },
        });
    }
    return reply.send({
        data: {
            access_token: payload.access_token,
            expires_at: payload.expires_at,
            token_type: payload.token_type,
            session_id: payload.session_id,
            user_id: payload.user_id,
        },
    });
}
function preventSensitiveResponseCaching(reply) {
    reply.header('Cache-Control', 'no-store, max-age=0');
    reply.header('Pragma', 'no-cache');
}
import { credentialRoutes } from './login.routes.js';
import { passwordRoutes } from './password.routes.js';
import { userRoutes } from './user.routes.js';
import { mfaRoutes } from './mfa.routes.js';
import { sessionRoutes } from './session.routes.js';
// ============================================================================
// MAIN EXPORT
// ============================================================================
export default async function authRoutes(fastify) {
    fastify.get('/health', async (_request, reply) => {
        return reply.send({
            data: {
                status: 'ok',
                module: 'auth',
                timestamp: new Date().toISOString(),
            },
        });
    });
    await fastify.register(credentialRoutes, { prefix: '' });
    await fastify.register(passwordRoutes, { prefix: '' });
    // Identity routes include /users/me/* paths — register before parametric /users/:id.
    await fastify.register(identityRoutes, { prefix: '' });
    await fastify.register(ssoOidcRoutes, { prefix: '' });
    await fastify.register(accountAdministrationRoutes, { prefix: '' });
    await fastify.register(samlIdentityRoutes, { prefix: '' });
    await fastify.register(provisioningRoutes, { prefix: '' });
    await fastify.register(userRoutes, { prefix: '' });
    await fastify.register(mfaRoutes, { prefix: '' });
    await fastify.register(sessionRoutes, { prefix: '' });
}
//# sourceMappingURL=index.js.map