import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from 'fastify';
import { authenticate } from '../../../shared/middleware/auth.js';
import { errorResponse } from '../../../shared/http/response.js';
import { bootstrapService, type BootstrapService } from './bootstrap.service.js';

interface BootstrapRouteOptions extends FastifyPluginOptions {
  service?: BootstrapService;
}

export async function bootstrapRoutes(
  fastify: FastifyInstance,
  options: BootstrapRouteOptions
): Promise<void> {
  const service = options.service ?? bootstrapService;

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      if (reply.sent) return reply;

      const user = (request as any).user;
      if (!user?.id) {
        return errorResponse(reply, 'UNAUTHORIZED', 'Authentication required', 401);
      }

      const preferredOrgId =
        (request.headers['x-org-id'] as string) ||
        (request.headers['x-organization-id'] as string) ||
        (request.query as any)?.orgId ||
        user.currentOrgId ||
        user.orgId ||
        null;

      const data = await service.getBootstrapContext(
        {
          id: user.id,
          email: user.email,
          name: user.name,
          avatarUrl: user.avatarUrl,
        },
        preferredOrgId
      );

      return reply.send({
        success: true,
        data,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Bootstrap context failed');
      if (reply.sent) return reply;
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
