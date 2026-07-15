import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../../../shared/middleware/requireorg.js';
import { CONNECTOR_PERMISSIONS, requireConnectorPermission } from '../../middleware/permissions.js';
import { SlackService } from './slack.service.js';

export async function slackConnectorRoutes(fastify: FastifyInstance): Promise<void> {
  const svc = new SlackService({
    repository: fastify.connectors.repository,
    connectorService: fastify.connectors.service,
    logger: fastify.log.child({ module: 'SlackConnectorRoutes' }),
  });

  const updateGuard = {
    preHandler: [
      authenticate,
      requireOrgAccess,
      requireConnectorPermission(CONNECTOR_PERMISSIONS.updateConnector),
    ],
  };

  // POST /organizations/:orgId/connectors/slack/oauth/start
  fastify.post('/organizations/:orgId/connectors/slack/oauth/start', updateGuard, async (request, reply) => {
    const { orgId } = z.object({ orgId: z.string() }).parse(request.params);
    const actorUserId = (request as any).user.id;
    const actorIp = request.ip ?? '0.0.0.0';
    const actorUserAgent = request.headers['user-agent'] ?? '';
    const result = await svc.startOAuth(orgId, actorUserId, actorIp, actorUserAgent);
    return reply.send({ success: true, data: result });
  });

  // GET /connectors/slack/oauth/callback (GLOBAL)
  fastify.get('/connectors/slack/oauth/callback', async (request, reply) => {
    const { code, state, error } = z.object({
      code: z.string().optional(),
      state: z.string().optional(),
      error: z.string().optional(),
    }).parse(request.query);

    if (error) {
      request.log.error({ error }, 'Slack OAuth returned an error');
      return reply.redirect('/settings/integrations/slack/error');
    }

    if (!code || !state) {
      return reply.code(400).send({ error: 'Missing code or state' });
    }

    try {
      const { connectorId } = await svc.handleCallback(code, state);
      // Redirect to frontend success page
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return reply.redirect(`${frontendUrl}/connectors/integrations/slack/success?connectorId=${connectorId}`);
    } catch (err: any) {
      request.log.error({ err }, 'Slack OAuth callback failed');
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return reply.redirect(`${frontendUrl}/connectors/integrations/slack/error`);
    }
  });

  // GET /organizations/:orgId/connectors/:id/slack/channels
  fastify.get('/organizations/:orgId/connectors/:id/slack/channels', updateGuard, async (request, reply) => {
    const { orgId, id } = z.object({ orgId: z.string(), id: z.string() }).parse(request.params);
    const result = await svc.listChannels(orgId, id);
    return reply.send({ success: true, data: result });
  });
}
