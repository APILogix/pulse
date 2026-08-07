import { authenticate } from '../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../shared/middleware/requireorg.js';
import { AppError } from '../../shared/errors/app-error.js';
function handleError(error, request, reply) {
    // Never attempt to send JSON once a stream has taken over the socket.
    if (reply.raw.headersSent || reply.sent) {
        request.log.warn({ err: error, path: request.url }, 'Observability stream error after headers sent');
        return;
    }
    if (error instanceof AppError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
        });
    }
    if (error instanceof Error && error.name === 'ZodError' && 'issues' in error) {
        return reply.code(422).send({
            success: false,
            error: { code: 'VALIDATION_ERROR', message: 'Invalid observability request', details: error.issues },
        });
    }
    request.log.error({ err: error, path: request.url }, 'Observability route failed');
    return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected observability error' } });
}
function wrap(handler) {
    return async (request, reply) => {
        try {
            return await handler(request, reply);
        }
        catch (error) {
            return handleError(error, request, reply);
        }
    };
}
export function buildObservabilityRoutes(controller) {
    return async function observabilityRoutes(fastify) {
        const guard = { preHandler: [authenticate, requireOrgAccess] };
        // ── Discovery / navigation ──────────────────────────────────────
        fastify.get('/navigation', guard, wrap(controller.navigation));
        fastify.get('/resources', guard, wrap(controller.resources));
        fastify.get('/releases', guard, wrap(controller.releases));
        // ── Dedicated Error Groups API ─────────────────────────────────
        fastify.get('/error-groups', guard, wrap(controller.errorGroupList));
        fastify.get('/error-groups/summary', guard, wrap(controller.errorGroupSummary));
        fastify.get('/error-groups/:id', guard, wrap(controller.errorGroupDetail));
        fastify.get('/error-groups/:id/history', guard, wrap(controller.errorGroupHistory));
        fastify.get('/error-groups/:id/events', guard, wrap(controller.errorGroupEvents));
        fastify.patch('/error-groups/:id/status', guard, wrap(controller.updateErrorGroupStatus));
        fastify.post('/error-groups/:id/resolve', guard, wrap(controller.updateErrorGroupStatus));
        fastify.post('/error-groups/:id/merge', guard, wrap(controller.mergeErrorGroups));
        // ── Per-resource explorer surface (static paths before :id) ─────
        fastify.get('/:resource', guard, wrap(controller.list));
        fastify.get('/:resource/summary', guard, wrap(controller.summary));
        fastify.get('/:resource/statistics', guard, wrap(controller.statistics));
        fastify.get('/:resource/timeline', guard, wrap(controller.timeline));
        fastify.get('/:resource/facets', guard, wrap(controller.facets));
        fastify.get('/:resource/stream', guard, wrap(controller.stream));
        fastify.post('/:resource/ask', guard, wrap(controller.askList));
        fastify.post('/:resource/analyze', guard, wrap(controller.analyzeBulk));
        // ── Detail + relationships + per-event AI ───────────────────────
        fastify.get('/:resource/:id', guard, wrap(controller.detail));
        fastify.get('/:resource/:id/related/:relation', guard, wrap(controller.related));
        fastify.post('/:resource/:id/ask', guard, wrap(controller.askEvent));
    };
}
//# sourceMappingURL=routes.js.map