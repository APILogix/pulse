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
// ============================================================================
// PASSWORD / EMAIL ROUTES
// ============================================================================
export async function passwordRoutes(fastify) {
    const forgotPassword = async (request, reply) => {
        try {
            const body = ForgotPasswordSchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await service.requestPasswordReset(body, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    };
    const resetPassword = async (request, reply) => {
        try {
            const body = ResetPasswordSchema.parse(request.body);
            const ci = getClientInfo(request);
            await service.resetPasswordWithToken(body, ci.ip, request.id);
            return reply.send({ message: 'Password reset successfully' });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    };
    fastify.post('/forgot-password', { preHandler: [forgotPasswordRateLimit] }, forgotPassword);
    fastify.post('/password/forgot', { preHandler: [forgotPasswordRateLimit] }, forgotPassword);
    fastify.post('/reset-password', { preHandler: [resetPasswordRateLimit] }, resetPassword);
    fastify.post('/password/reset', { preHandler: [resetPasswordRateLimit] }, resetPassword);
    // POST /auth/resend-verification
    fastify.post('/resend-verification', { preHandler: [resendVerificationRateLimit] }, async (request, reply) => {
        try {
            const body = ResendVerificationSchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await service.resendVerification(body, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // GET /auth/verify-email
    fastify.get('/verify-email', { preHandler: [verifyEmailRateLimit] }, async (request, reply) => {
        try {
            preventSensitiveResponseCaching(reply);
            const query = VerifyEmailQuerySchema.parse(request.query);
            const ci = getClientInfo(request);
            const result = await service.verifyEmail(query, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // POST /auth/verify-email/confirm
    // Safer SPA flow: read the token client-side and POST it, instead of relying
    // on a GET confirmation endpoint as the only supported redemption path.
    fastify.post('/verify-email/confirm', { preHandler: [tokenConfirmRateLimit] }, async (request, reply) => {
        try {
            preventSensitiveResponseCaching(reply);
            const body = VerifyEmailConfirmSchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await service.verifyEmail(body, ci.ip, request.id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // POST /auth/password/change
    // Requires: authenticated session AND fresh step-up MFA challenge.
    // BUG-003 FIX: Enforce requireStepUp on all sensitive routes.
    fastify.post('/password/change', { preHandler: [authenticate, requireStepUp] }, async (request, reply) => {
        try {
            const r = request;
            const body = ChangePasswordSchema.parse(r.body);
            const ci = getClientInfo(r);
            // BUG-003 FIX: Explicitly pass isAdmin to prevent privilege escalation.
            const session = await service.changePassword(r.user.id, r.user.sessionId, body, r.user.mfaVerified, ci.ip, ci.userAgent, r.id);
            return await sendAuthSession(reply, {
                ...session,
                token_type: 'Bearer',
            });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
}
//# sourceMappingURL=password.routes.js.map