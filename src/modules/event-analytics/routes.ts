/**
 * Event-analytics routes.
 *
 * Organization-scoped under /organizations/:orgId/analytics. Every route runs
 * `authenticate` + `requireOrgAccess`. No caching, no rate limiting (per
 * requirements). SSE "live" endpoints stream via a bounded DB poll loop (no
 * Redis pub/sub dependency) and clean up on client disconnect.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { authenticate } from '../../shared/middleware/auth.js';
import { requireOrgAccess } from '../../shared/middleware/requireorg.js';
import { AppError } from '../../shared/errors/app-error.js';
import { toCsv } from './csv.js';
import {
  CreateAnalyticsAlertSchema,
  CreateDashboardSchema,
  CreateSavedQuerySchema,
  CronHistoryQuerySchema,
  ExportSchema,
  ListErrorGroupsQuerySchema,
  ListErrorsQuerySchema,
  ListLogsQuerySchema,
  ListRequestsQuerySchema,
  ListSessionsQuerySchema,
  ListTracesQuerySchema,
  MetricSeriesQuerySchema,
  OrgIdParamsSchema,
  PaginationSchema,
  ResolveGroupSchema,
  RoutePerfQuerySchema,
  TimeRangeQuerySchema,
  TrendsQuerySchema,
  UpdateDashboardSchema,
  UuidSchema,
  type RequestMeta,
} from './types.js';

type AuthedRequest = FastifyRequest & { user: { id: string } };

function meta(request: FastifyRequest): RequestMeta {
  const ua = request.headers['user-agent'];
  return {
    actorUserId: (request as AuthedRequest).user.id,
    actorIp: request.ip ?? '0.0.0.0',
    actorUserAgent: typeof ua === 'string' ? ua : null,
    requestId: request.id,
  };
}

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.code(error.statusCode).send({ success: false, error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } });
  }
  return reply.code(500).send({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Unexpected analytics error' } });
}

function wrap(handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    try { return await handler(request, reply); }
    catch (error) { request.log.error({ err: error, path: request.url }, 'Event-analytics route failed'); return handleError(error, reply); }
  };
}

export async function eventAnalyticsRoutes(fastify: FastifyInstance): Promise<void> {
  const svc = fastify.eventAnalytics.service;
  const guard = { preHandler: [authenticate, requireOrgAccess] };
  const orgId = (request: FastifyRequest) => OrgIdParamsSchema.parse(request.params).orgId;

  // ═══════════ OVERVIEW / TRENDS / HEALTH ═══════════
  fastify.get('/overview', guard, wrap(async (req, reply) => {
    const q = TimeRangeQuerySchema.parse(req.query ?? {});
    return reply.send({ success: true, data: await svc.getOverview(orgId(req), q) });
  }));
  fastify.get('/trends', guard, wrap(async (req, reply) => {
    const q = TrendsQuerySchema.parse(req.query ?? {});
    return reply.send({ success: true, data: await svc.getTrends(orgId(req), q) });
  }));
  fastify.get('/health', guard, wrap(async (req, reply) => {
    const q = TimeRangeQuerySchema.parse(req.query ?? {});
    return reply.send({ success: true, data: await svc.getHealth(orgId(req), q) });
  }));

  // ═══════════ ERRORS ═══════════
  fastify.get('/errors', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, ...(await svc.listErrors(orgId(req), ListErrorsQuerySchema.parse(req.query ?? {}))) });
  }));
  fastify.get('/errors/groups', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, ...(await svc.listErrorGroups(orgId(req), ListErrorGroupsQuerySchema.parse(req.query ?? {}))) });
  }));
  fastify.get('/errors/trends', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.getErrorTrends(orgId(req), TrendsQuerySchema.parse(req.query ?? {})) });
  }));
  fastify.get('/errors/groups/:fingerprint', guard, wrap(async (req, reply) => {
    const { fingerprint } = req.params as { fingerprint: string };
    return reply.send({ success: true, data: await svc.getErrorGroup(orgId(req), fingerprint) });
  }));
  fastify.post('/errors/groups/:fingerprint/resolve', guard, wrap(async (req, reply) => {
    const { fingerprint } = req.params as { fingerprint: string };
    const body = ResolveGroupSchema.parse(req.body ?? {});
    return reply.send({ success: true, data: await svc.setErrorGroupStatus(orgId(req), meta(req), fingerprint, 'resolved', body.actorId ?? null) });
  }));
  fastify.post('/errors/groups/:fingerprint/ignore', guard, wrap(async (req, reply) => {
    const { fingerprint } = req.params as { fingerprint: string };
    return reply.send({ success: true, data: await svc.setErrorGroupStatus(orgId(req), meta(req), fingerprint, 'ignored', null) });
  }));
  fastify.get('/errors/:id', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await svc.getError(orgId(req), UuidSchema.parse(id)) });
  }));

  // ═══════════ PERFORMANCE ═══════════
  fastify.get('/performance/routes', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.getRoutePerformance(orgId(req), RoutePerfQuerySchema.parse(req.query ?? {})) });
  }));
  fastify.get('/performance/distribution', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.getLatencyDistribution(orgId(req), TimeRangeQuerySchema.parse(req.query ?? {})) });
  }));
  fastify.get('/performance/apdex', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.getApdex(orgId(req), TimeRangeQuerySchema.parse(req.query ?? {})) });
  }));

  // ═══════════ REQUESTS ═══════════
  fastify.get('/requests', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, ...(await svc.listRequests(orgId(req), ListRequestsQuerySchema.parse(req.query ?? {}))) });
  }));
  fastify.get('/requests/waterfall/:traceId', guard, wrap(async (req, reply) => {
    const { traceId } = req.params as { traceId: string };
    return reply.send({ success: true, data: await svc.getTraceWaterfall(orgId(req), traceId) });
  }));
  fastify.get('/requests/:id', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await svc.getRequest(orgId(req), UuidSchema.parse(id)) });
  }));

  // ═══════════ TRACES ═══════════
  fastify.get('/traces', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, ...(await svc.listTraces(orgId(req), ListTracesQuerySchema.parse(req.query ?? {}))) });
  }));
  fastify.get('/traces/:traceId', guard, wrap(async (req, reply) => {
    const { traceId } = req.params as { traceId: string };
    return reply.send({ success: true, data: await svc.getTrace(orgId(req), traceId) });
  }));

  // ═══════════ METRICS ═══════════
  fastify.get('/metrics', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.listMetricNames(orgId(req), TimeRangeQuerySchema.parse(req.query ?? {})) });
  }));
  fastify.get('/metrics/:name/stats', guard, wrap(async (req, reply) => {
    const { name } = req.params as { name: string };
    return reply.send({ success: true, data: await svc.getMetricStats(orgId(req), name, TimeRangeQuerySchema.parse(req.query ?? {})) });
  }));
  fastify.get('/metrics/:name', guard, wrap(async (req, reply) => {
    const { name } = req.params as { name: string };
    return reply.send({ success: true, data: await svc.getMetricSeries(orgId(req), name, MetricSeriesQuerySchema.parse(req.query ?? {})) });
  }));

  // ═══════════ LOGS ═══════════
  fastify.get('/logs', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, ...(await svc.listLogs(orgId(req), ListLogsQuerySchema.parse(req.query ?? {}))) });
  }));
  fastify.get('/logs/stream', guard, wrap(async (req, reply) => {
    const q = TimeRangeQuerySchema.parse(req.query ?? {});
    return streamPoll(req, reply, (since) => svc.pollLogsSince(orgId(req), since, q.projectId));
  }));

  // ═══════════ SESSIONS / USERS ═══════════
  fastify.get('/sessions', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, ...(await svc.listSessions(orgId(req), ListSessionsQuerySchema.parse(req.query ?? {}))) });
  }));
  fastify.get('/sessions/:sessionId', guard, wrap(async (req, reply) => {
    const { sessionId } = req.params as { sessionId: string };
    return reply.send({ success: true, data: await svc.getSession(orgId(req), sessionId) });
  }));
  fastify.get('/users', guard, wrap(async (req, reply) => {
    const q = TimeRangeQuerySchema.parse(req.query ?? {});
    const page = PaginationSchema.parse(req.query ?? {});
    return reply.send({ success: true, data: await svc.listUsers(orgId(req), { ...q, limit: page.limit, offset: page.offset }) });
  }));
  fastify.get('/users/:userId', guard, wrap(async (req, reply) => {
    const { userId } = req.params as { userId: string };
    return reply.send({ success: true, data: await svc.getUserJourney(orgId(req), userId, TimeRangeQuerySchema.parse(req.query ?? {})) });
  }));

  // ═══════════ CRONS ═══════════
  fastify.get('/crons', guard, wrap(async (req, reply) => {
    const q = TimeRangeQuerySchema.parse(req.query ?? {});
    return reply.send({ success: true, data: await svc.listCrons(orgId(req), q.projectId) });
  }));
  fastify.get('/crons/:slug/history', guard, wrap(async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const page = CronHistoryQuerySchema.parse(req.query ?? {});
    return reply.send({ success: true, data: await svc.getCronHistory(orgId(req), slug, page.limit, page.offset) });
  }));
  fastify.get('/crons/:slug', guard, wrap(async (req, reply) => {
    const { slug } = req.params as { slug: string };
    const history = await svc.getCronHistory(orgId(req), slug, 1, 0);
    return reply.send({ success: true, data: { slug, latest: history[0] ?? null } });
  }));

  // ═══════════ LIVE (SSE) ═══════════
  fastify.get('/live/errors', guard, wrap(async (req, reply) => {
    const q = TimeRangeQuerySchema.parse(req.query ?? {});
    return streamPoll(req, reply, (since) => svc.pollErrorsSince(orgId(req), since, q.projectId));
  }));

  // ═══════════ DASHBOARDS ═══════════
  fastify.post('/dashboards', guard, wrap(async (req, reply) => {
    return reply.code(201).send({ success: true, data: await svc.createDashboard(orgId(req), meta(req), CreateDashboardSchema.parse(req.body)) });
  }));
  fastify.get('/dashboards', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.listDashboards(orgId(req)) });
  }));
  fastify.get('/dashboards/:id', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await svc.getDashboard(orgId(req), UuidSchema.parse(id)) });
  }));
  fastify.patch('/dashboards/:id', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await svc.updateDashboard(orgId(req), meta(req), UuidSchema.parse(id), UpdateDashboardSchema.parse(req.body)) });
  }));
  fastify.delete('/dashboards/:id', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    await svc.deleteDashboard(orgId(req), meta(req), UuidSchema.parse(id));
    return reply.code(204).send();
  }));
  fastify.post('/dashboards/:id/duplicate', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.code(201).send({ success: true, data: await svc.duplicateDashboard(orgId(req), meta(req), UuidSchema.parse(id)) });
  }));

  // ═══════════ SAVED QUERIES ═══════════
  fastify.post('/queries', guard, wrap(async (req, reply) => {
    return reply.code(201).send({ success: true, data: await svc.createSavedQuery(orgId(req), meta(req), CreateSavedQuerySchema.parse(req.body)) });
  }));
  fastify.get('/queries', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.listSavedQueries(orgId(req)) });
  }));
  fastify.delete('/queries/:id', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    await svc.deleteSavedQuery(orgId(req), meta(req), UuidSchema.parse(id));
    return reply.code(204).send();
  }));
  fastify.post('/queries/:id/execute', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    return reply.send({ success: true, data: await svc.executeSavedQuery(orgId(req), UuidSchema.parse(id)) });
  }));

  // ═══════════ ALERTS ═══════════
  fastify.post('/alerts', guard, wrap(async (req, reply) => {
    return reply.code(201).send({ success: true, data: await svc.createAlert(orgId(req), meta(req), CreateAnalyticsAlertSchema.parse(req.body)) });
  }));
  fastify.get('/alerts', guard, wrap(async (req, reply) => {
    return reply.send({ success: true, data: await svc.listAlerts(orgId(req)) });
  }));
  fastify.delete('/alerts/:id', guard, wrap(async (req, reply) => {
    const { id } = req.params as { id: string };
    await svc.deleteAlert(orgId(req), meta(req), UuidSchema.parse(id));
    return reply.code(204).send();
  }));

  // ═══════════ EXPORT ═══════════
  fastify.post('/export', guard, wrap(async (req, reply) => {
    const body = ExportSchema.parse(req.body);
    const { rows, format } = await svc.exportData(orgId(req), body);
    if (format === 'csv') {
      return reply.header('Content-Type', 'text/csv').header('Content-Disposition', `attachment; filename="${body.dataset}.csv"`).send(toCsv(rows));
    }
    return reply.send({ success: true, data: rows });
  }));
}

/**
 * Minimal SSE stream backed by a bounded DB poll loop. Emits new rows every
 * ~3s using the latest row timestamp as the cursor. Cleans up on disconnect.
 * (No Redis pub/sub — acceptable for a low-fanout live feed; documented.)
 */
async function streamPoll(
  request: FastifyRequest,
  reply: FastifyReply,
  fetchSince: (since: Date) => Promise<Array<Record<string, unknown>>>,
): Promise<void> {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  reply.raw.write(`event: open\ndata: {}\n\n`);

  let cursor = new Date();
  let closed = false;

  const tick = async (): Promise<void> => {
    if (closed) return;
    try {
      const rows = await fetchSince(cursor);
      for (const row of rows) {
        const ts = row.timestamp ? new Date(row.timestamp as string) : null;
        if (ts && ts > cursor) cursor = ts;
        reply.raw.write(`data: ${JSON.stringify(row)}\n\n`);
      }
    } catch (err) {
      request.log.warn({ err }, 'SSE poll failed');
    }
  };

  const interval = setInterval(() => void tick(), 3000);
  const heartbeat = setInterval(() => { if (!closed) reply.raw.write(`: ping\n\n`); }, 15000);

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
    try { reply.raw.end(); } catch { /* ignore */ }
  };
  request.raw.on('close', cleanup);
  request.raw.on('error', cleanup);
}
