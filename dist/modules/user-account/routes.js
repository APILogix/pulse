import { z } from 'zod';
import { authenticate } from '../../shared/middleware/auth.js';
import { errorResponse } from '../../shared/http/response.js';
import * as service from './service.js';
const profileSchema = z.object({
    display_name: z.string().min(1).max(100),
    full_name: z.string().min(1).max(255).nullable().optional(),
    avatar_url: z.string().url().nullable().optional(),
    timezone: z.string().min(1),
    locale: z.string().min(2).max(20),
    marketing_emails: z.boolean(),
    product_updates: z.boolean(),
});
const protectedActionSchema = z.object({
    password: z.string().optional(),
    mfa_code: z.string().optional(),
});
const deleteAccountSchema = protectedActionSchema.extend({
    confirmation_text: z.string(),
});
function handleError(error, reply, request) {
    if (error instanceof service.UserAccountError) {
        return errorResponse(reply, error.code, error.message, error.statusCode, error.details);
    }
    const zod = error;
    if (zod?.name === 'ZodError') {
        return errorResponse(reply, 'VALIDATION_ERROR', 'Invalid request payload', 400, { issues: zod.issues });
    }
    request.log.error({ err: error }, 'Unexpected user account error');
    return errorResponse(reply, 'INTERNAL_ERROR', 'An unexpected error occurred', 500);
}
export async function userAccountRoutes(fastify) {
    fastify.get('/account/overview', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            return reply.send(await service.getAccountOverview(r.user.id));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
    fastify.get('/profile', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            return reply.send(await service.getProfile(r.user.id));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
    fastify.patch('/profile', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const body = profileSchema.parse(request.body);
            return reply.send(await service.updateProfile(r.user.id, body, request));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
    fastify.delete('/avatar', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            return reply.send(await service.deleteAvatar(r.user.id, request));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
    fastify.post('/account/export-data', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const body = protectedActionSchema.parse(request.body ?? {});
            return reply.send(await service.requestDataExport(r.user.id, body, request));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
    fastify.delete('/account', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            const body = deleteAccountSchema.parse(request.body ?? {});
            return reply.send(await service.scheduleDeletion(r.user.id, body, request));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
    fastify.post('/account/cancel-deletion', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            return reply.send(await service.cancelDeletion(r.user.id, request));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
    fastify.post('/sessions/sign-out-all-devices', { preHandler: [authenticate] }, async (request, reply) => {
        try {
            const r = request;
            return reply.send(await service.signOutAllOtherDevices(r.user.id, r.user.sessionId, request));
        }
        catch (error) {
            return handleError(error, reply, request);
        }
    });
}
//# sourceMappingURL=routes.js.map