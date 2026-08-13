import { authenticate } from '../../../shared/middleware/auth.js';
import { errorResponse } from '../../../shared/http/response.js';
import { bootstrapService } from './bootstrap.service.js';
export async function bootstrapRoutes(fastify, options) {
    const service = options.service ?? bootstrapService;
    const handler = async (request, reply) => {
        try {
            if (reply.sent)
                return reply;
            const user = request.user;
            if (!user?.id) {
                return errorResponse(reply, 'UNAUTHORIZED', 'Authentication required', 401);
            }
            const preferredOrgId = request.headers['x-org-id'] ||
                request.headers['x-organization-id'] ||
                request.query?.orgId ||
                user.currentOrgId ||
                user.orgId ||
                null;
            const data = await service.getBootstrapContext({
                id: user.id,
                email: user.email,
                name: user.name,
                avatarUrl: user.avatarUrl,
            }, preferredOrgId);
            return reply.send({
                success: true,
                data,
            });
        }
        catch (error) {
            request.log.error({ err: error }, 'Bootstrap context failed');
            if (reply.sent)
                return reply;
            return errorResponse(reply, 'INTERNAL_ERROR', 'Unexpected bootstrap module error', 500);
        }
    };
    // Routes are registered under prefixes '/api/v1' and '' by organization.module.ts
    // prefix '/api/v1' + '/me/bootstrap' => GET /api/v1/me/bootstrap
    // prefix '' + '/me/bootstrap' => GET /me/bootstrap
    fastify.get('/me/bootstrap', { preHandler: [authenticate] }, handler);
    fastify.get('/bootstrap', { preHandler: [authenticate] }, handler);
}
export default bootstrapRoutes;
//# sourceMappingURL=bootstrap.routes.js.map