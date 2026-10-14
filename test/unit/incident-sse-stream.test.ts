import { describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import Fastify from 'fastify';

vi.mock('../../src/shared/middleware/auth.js', () => ({
  authenticate: async (request: any) => {
    request.user = { id: 'usr_test_123' };
  },
}));

vi.mock('../../src/shared/middleware/requireorg.js', () => ({
  requireOrgAccess: async () => {},
}));

import { incidentsRoutes } from '../../src/modules/alerting/incidents/incidents.routes.js';
import { IncidentsService } from '../../src/modules/alerting/incidents/incidents.service.js';

const ORG_ID = '11111111-1111-4111-8111-111111111111';

describe('Real-Time Incident Stream (SSE) — Phase 5', () => {
  it('streams text/event-stream headers and sends connected frame with Last-Event-ID handshake', async () => {
    const fastify = Fastify({ logger: false });

    // Mock auth and org access decorators
    fastify.addHook('onRequest', async (req) => {
      (req as any).user = { id: 'usr_test_123' };
    });

    const mockRepo = {
      list: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    } as any;

    const mockService = new IncidentsService({
      repository: mockRepo,
      logger: fastify.log,
      logDb: { query: vi.fn() } as any,
    });

    fastify.decorate('alerting', { incidents: mockService });

    await fastify.register(incidentsRoutes, {
      prefix: '/organizations/:orgId/alerting',
    });

    await fastify.listen({ port: 0, host: '127.0.0.1' });
    const address = fastify.server.address() as { port: number };

    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          `http://127.0.0.1:${address.port}/organizations/${ORG_ID}/alerting/incidents/stream`,
          { headers: { 'last-event-id': 'evt_998877' } },
          (res) => {
            try {
              expect(res.statusCode).toBe(200);
              expect(res.headers['content-type']).toContain('text/event-stream');
              expect(res.headers['cache-control']).toContain('no-cache');

              let buffer = '';
              res.on('data', (chunk) => {
                buffer += chunk.toString();
                if (buffer.includes('event: connected')) {
                  try {
                    expect(buffer).toContain('evt_998877');
                    expect(buffer).toContain(ORG_ID);
                    req.destroy();
                    resolve();
                  } catch (e) {
                    req.destroy();
                    reject(e);
                  }
                }
              });
            } catch (e) {
              req.destroy();
              reject(e);
            }
          },
        );

        req.on('error', (err) => {
          // If already resolved, destroy throws abort/reset which is expected
        });
      });
    } finally {
      await fastify.close();
    }
  });
});
