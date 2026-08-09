import { authenticate } from '../../../shared/middleware/auth.js';
import { ProjectParamsSchema } from '../../projects/types.js';
import { ProjectMemberRole } from '../../projects/types.js';
import { PaginationSchema, UuidSchema } from '../common.js';
import { z } from 'zod';
const ProjectAlertListParamsSchema = ProjectParamsSchema;
const ProjectAlertDetailParamsSchema = ProjectParamsSchema.extend({ alertEventId: UuidSchema });
const ProjectAlertQuerySchema = PaginationSchema.extend({
    status: z.string().max(32).optional(),
    severity: z.string().max(16).optional(),
});
export async function projectAlertQueryRoutes(fastify) {
    fastify.get('/projects/:projectId/alerts', { preHandler: [authenticate] }, async (request, reply) => {
        const { orgId, projectId } = ProjectAlertListParamsSchema.parse(request.params);
        const query = ProjectAlertQuerySchema.parse(request.query ?? {});
        await fastify.projects.service.requireProjectAccess(orgId, projectId, request.user.id, ProjectMemberRole.VIEWER);
        const result = await fastify.alerting.projectAlerts.list(orgId, projectId, {
            limit: query.limit,
            offset: query.offset,
            ...(query.status !== undefined ? { status: query.status } : {}),
            ...(query.severity !== undefined ? { severity: query.severity } : {}),
        });
        return reply.send({ success: true, data: result.data, meta: { total: result.total, limit: query.limit, offset: query.offset } });
    });
    fastify.get('/projects/:projectId/alerts/:alertEventId', { preHandler: [authenticate] }, async (request, reply) => {
        const { orgId, projectId, alertEventId } = ProjectAlertDetailParamsSchema.parse(request.params);
        await fastify.projects.service.requireProjectAccess(orgId, projectId, request.user.id, ProjectMemberRole.VIEWER);
        const alert = await fastify.alerting.projectAlerts.get(orgId, projectId, alertEventId);
        if (!alert)
            return reply.code(404).send({ success: false, error: { code: 'ALERT_NOT_FOUND', message: 'Alert not found' } });
        return reply.send({ success: true, data: alert });
    });
}
//# sourceMappingURL=project-alert-query.routes.js.map