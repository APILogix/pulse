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
        const defaultOrgId = orgContext.organizations.find((org) => org.slug === orgContext.default_org_slug)?.id ?? null;
        return reply.send({
            data: {
                access_token: payload.access_token,
                expires_at: payload.expires_at,
                token_type: payload.token_type,
                session_id: payload.session_id,
                current_org_id: user?.current_org_id ?? defaultOrgId,
                user: user ? {
                    id: user.id,
                    email: user.email,
                    name: user.full_name,
                } : undefined,
                default_org_slug: orgContext.default_org_slug,
                default_org_id: defaultOrgId,
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
// CREDENTIAL ROUTES
// ============================================================================
export async function credentialRoutes(fastify) {
    // POST /auth/login
    fastify.post('/login', { preHandler: [loginRateLimit] }, async (request, reply) => {
        try {
            const body = LoginSchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await service.loginWithEmailPassword(body, ci.ip, ci.userAgent, ci.device.type, request.id);
            if (result.mfa_required) {
                return reply.status(202).send({
                    data: {
                        mfa_required: true,
                        challenge_id: result.challenge_id,
                        expires_at: result.expires_at,
                        device_type: result.device_type,
                        available_methods: result.available_methods,
                    },
                });
            }
            return await sendAuthSession(reply, result);
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // POST /auth/login/mfa
    fastify.post('/login/mfa', { preHandler: [loginMfaRateLimit] }, async (request, reply) => {
        try {
            const body = LoginMFAVerifySchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await service.verifyLoginMFAChallenge(body, ci.ip, ci.userAgent, ci.device.type, request.id);
            return await sendAuthSession(reply, result);
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // POST /auth/login/mfa/switch
    fastify.post('/login/mfa/switch', { preHandler: [loginMfaRateLimit] }, async (request, reply) => {
        try {
            const { z } = await import('zod');
            const body = z.object({
                challenge_id: z.string().min(1),
                device_id: z.string().min(1)
            }).parse(request.body);
            const result = await service.switchLoginMfaMethod(body.challenge_id, body.device_id);
            return reply.send({ data: result });
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
    // POST /auth/login/backup-code
    fastify.post('/login/backup-code', { preHandler: [loginMfaRateLimit] }, async (request, reply) => {
        try {
            const body = BackupCodeLoginSchema.parse(request.body);
            const ci = getClientInfo(request);
            const result = await service.verifyLoginBackupCode(body, ci.ip, ci.userAgent, ci.device.type, request.id);
            return await sendAuthSession(reply, result);
        }
        catch (error) {
            return handleAuthError(error, reply, request);
        }
    });
}
//# sourceMappingURL=login.routes.js.map