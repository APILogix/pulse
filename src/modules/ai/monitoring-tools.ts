import { randomUUID } from 'crypto';

import type { AnalyticsService } from '../analytics/service.js';
import type { AlertingService } from '../alerting/service.js';
import type { EventAnalyticsService } from '../event-analytics/service.js';
import type { AccessibleProject, ChatToolCallRecord } from './repository.js';
import { sanitizeUntrusted, stableStringify } from './security.js';

export interface MonitoringSource {
  sourceId: string;
  sourceType: 'tool';
  title: string;
  reference: string;
  content: string;
  observedAt: string;
}

export interface MonitoringToolResult {
  sources: MonitoringSource[];
  calls: ChatToolCallRecord[];
}

interface ToolInput {
  tenantId: string;
  question: string;
  projects: AccessibleProject[];
  requestedProjectId?: string;
  from: Date;
  to: Date;
  timeExpression: string;
}

function boundedResult(value: unknown): unknown {
  return sanitizeUntrusted(value, 20_000).value;
}

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;

function extractUuid(question: string): string | undefined {
  return question.match(UUID_PATTERN)?.[0];
}

function extractTraceId(question: string): string | undefined {
  return question.match(/\btrace(?:\s+id)?\s*[:#]?\s*\[?([a-z0-9-]{16,64})\]?/i)?.[1];
}

function extractServiceName(question: string): string | undefined {
  if (/\bapi[ -]gateway\b/i.test(question)) return 'api-gateway';
  const match = question.match(/\b([a-z0-9][a-z0-9._-]{0,99})\s+service\b/i)
    ?? question.match(/\bservice\s*[:=]\s*([a-z0-9][a-z0-9._-]{0,99})\b/i);
  return match?.[1]?.toLowerCase();
}

function extractSearchPhrase(question: string): string | undefined {
  const quoted = question.match(/["']([^"']{1,500})["']/)?.[1];
  if (quoted) return quoted;
  return question.match(/\b(?:containing|contains|matching|matches)\s+([a-z0-9][\w .:/-]{0,200})/i)?.[1]?.trim();
}

function extractLogLevel(question: string): 'debug' | 'info' | 'warn' | 'error' | undefined {
  if (/\b(?:error|fatal)\s+logs?\b|\blogs?\s+(?:with\s+)?(?:level\s+)?(?:error|fatal)\b/i.test(question)) return 'error';
  if (/\b(?:warn|warning)\s+logs?\b|\blogs?\s+(?:with\s+)?(?:level\s+)?(?:warn|warning)\b/i.test(question)) return 'warn';
  if (/\binfo\s+logs?\b/i.test(question)) return 'info';
  if (/\bdebug\s+logs?\b/i.test(question)) return 'debug';
  return undefined;
}

function extractMinDurationMs(question: string): number | undefined {
  const match = question.match(/\b(?:slower|longer)\s+than\s+(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|seconds?)\b/i);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Math.round(/^s|second/i.test(match[2]!) ? value * 1_000 : value);
}

function extractClockWindow(question: string, input: Pick<ToolInput, 'from' | 'to'>): { from: Date; to: Date } | null {
  const match = question.match(/\b(?:at|around)\s+([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (!match) return null;
  const base = /\byesterday\b/i.test(question) ? input.from : input.to;
  const center = new Date(Date.UTC(
    base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), Number(match[1]), Number(match[2]),
  ));
  return {
    from: new Date(center.getTime() - 15 * 60_000),
    to: new Date(center.getTime() + 15 * 60_000),
  };
}

function mentionedProject(question: string, projects: AccessibleProject[]): AccessibleProject | undefined {
  return projects.find((project) => {
    const name = project.name.toLowerCase();
    const slug = project.slug.toLowerCase();
    return question.includes(name) || question.includes(slug);
  });
}

export class MonitoringTools {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly alerting: AlertingService,
    private readonly eventAnalytics: EventAnalyticsService,
  ) {}

  async execute(input: ToolInput): Promise<MonitoringToolResult> {
    const sources: MonitoringSource[] = [];
    const calls: ChatToolCallRecord[] = [];
    const question = input.question.toLowerCase();
    const selectedProject = input.requestedProjectId
      ? input.projects.find((project) => project.id === input.requestedProjectId)
      : mentionedProject(question, input.projects) ?? (input.projects.length === 1 ? input.projects[0] : undefined);
    const projectId = selectedProject?.id;
    const baseQuery = {
      range: '24h' as const,
      from: input.from,
      to: input.to,
      ...(projectId ? { projectId } : {}),
    };

    if (/\b(?:show|list|what|which).*\bprojects?\b|\bprojects?\s+(?:do we|are we)\s+monitor/i.test(question)) {
      this.addResult(sources, calls, 'list_monitored_projects', null, {}, {
        monitoredProjects: input.projects.map(({ id, name, slug, environment }) => ({ id, name, slug, environment })),
      }, 0, 'Monitored projects');
    }

    const metricIntent = /latency|throughput|request|error rate|p50|p95|p99|metric/i.test(question);
    if (metricIntent) {
      await this.capture(sources, calls, 'query_metrics', projectId ?? null,
        { from: input.from.toISOString(), to: input.to.toISOString(), expression: input.timeExpression },
        async () => {
          const metrics = await this.eventAnalytics.getOverview(input.tenantId, baseQuery);
          const requests = metrics.requests as { total?: number; errorRate?: number } | undefined;
          const durationMinutes = Math.max(1, (input.to.getTime() - input.from.getTime()) / 60_000);
          return {
            timeRangeExpression: input.timeExpression,
            errorRatePercent: Number(((requests?.errorRate ?? 0) * 100).toFixed(4)),
            throughputPerMinute: Number(((requests?.total ?? 0) / durationMinutes).toFixed(4)),
            metrics,
          };
        },
        selectedProject ? `Live request metrics for ${selectedProject.name}` : 'Live organization request metrics');

      if (/trend|over time|time series|daily|hourly|weekly|increasing|compared?|versus|\bvs\b/i.test(question)) {
        const durationMs = input.to.getTime() - input.from.getTime();
        const granularity = durationMs <= 48 * 60 * 60 * 1_000 ? 'hour'
          : durationMs <= 60 * 24 * 60 * 60 * 1_000 ? 'day' : 'week';
        await this.capture(sources, calls, 'query_metric_trends', projectId ?? null,
          { from: input.from.toISOString(), to: input.to.toISOString(), granularity },
          () => this.eventAnalytics.getTrends(input.tenantId, { ...baseQuery, granularity }),
          'Live request metric trends');
      }
    }

    const traceIntent = /\btraces?\b|critical path|\bspans?\b|bottleneck|n\+1/i.test(question);
    if (traceIntent) {
      const traceId = extractTraceId(input.question);
      if (traceId && /show|explain|critical path|bottleneck|trace\s+(?:id\s*)?[#:]?\s*\[?/i.test(question)) {
        await this.capture(sources, calls, 'query_traces', projectId ?? null,
          { traceId, includeSpans: true },
          () => this.eventAnalytics.getTrace(input.tenantId, traceId),
          `Trace ${traceId}`);
      } else {
        const service = extractServiceName(input.question);
        const minDurationMs = extractMinDurationMs(input.question);
        const errorOnly = /\b(?:traces?\s+with\s+errors?|error\s+traces?|failed\s+traces?)\b/i.test(question);
        await this.capture(sources, calls, 'query_traces', projectId ?? null,
          { from: input.from.toISOString(), to: input.to.toISOString(), limit: 20,
            ...(service ? { service } : {}), ...(minDurationMs !== undefined ? { minDurationMs } : {}), errorOnly },
          () => this.eventAnalytics.listTraces(input.tenantId, {
            ...baseQuery, limit: 20, offset: 0,
            ...(service ? { service } : {}),
            ...(minDurationMs !== undefined ? { minDurationMs } : {}),
            ...(errorOnly ? { errorOnly: true } : {}),
          }),
          'Matching distributed traces');
      }
    }

    const logIntent = /\blogs?\b|stack trace|most (?:common|frequent) (?:error|warning)|how many times.*error|error.*occur/i.test(question);
    if (logIntent) {
      const logId = /\blog(?:\s+id)?\b/i.test(question) ? extractUuid(input.question) : undefined;
      if (logId) {
        await this.capture(sources, calls, 'query_logs', projectId ?? null, { logId },
          () => this.eventAnalytics.getLog(input.tenantId, logId), `Log ${logId}`);
      } else {
        const level = extractLogLevel(input.question);
        const search = extractSearchPhrase(input.question);
        const service = extractServiceName(input.question);
        const securityOnly = /\bsecurity (?:events?|logs?)\b|privilege escalation|auth(?:entication)? failures?/i.test(question);
        const clockWindow = extractClockWindow(input.question, input);
        const logQuery = {
          ...baseQuery,
          ...(clockWindow ?? {}),
          limit: 20,
          offset: 0,
          ...(level ? { level } : {}),
          ...(service ? { service } : {}),
          ...(search ? { search } : {}),
          ...(securityOnly ? { securityOnly: true } : {}),
        };
        await this.capture(sources, calls, 'query_logs', projectId ?? null,
          { from: logQuery.from.toISOString(), to: logQuery.to.toISOString(), limit: 20,
            ...(level ? { level } : {}), ...(service ? { service } : {}),
            ...(search ? { search } : {}), securityOnly },
          async () => {
            const result = await this.eventAnalytics.listLogs(input.tenantId, logQuery);
            const meta = result.meta as { total?: number } | undefined;
            return { ...result, truncated: (meta?.total ?? 0) > 20 };
          },
          'Matching organization logs');
        if (/most (?:common|frequent)|top (?:error|warning)|group|cluster/i.test(question)) {
          await this.capture(sources, calls, 'summarize_logs', projectId ?? null,
            { from: logQuery.from.toISOString(), to: logQuery.to.toISOString(), limit: 20 },
            () => this.eventAnalytics.summarizeLogs(input.tenantId, logQuery, {
              limit: 20, ...(level ? { level } : {}), ...(service ? { service } : {}), ...(search ? { search } : {}),
            }),
            'Grouped organization log patterns');
        }
      }
    }

    const serviceIntent = /\b(?:what|which|list|show|all)\s+services?\b|services?\s+(?:do we|are we)\s+monitor|service\s+still\s+receiving\s+traffic/i.test(question);
    if (serviceIntent) {
      const catalogFrom = input.timeExpression === 'last hour (default)'
        && !/still receiving traffic|right now|current/i.test(question)
        ? new Date(input.to.getTime() - 30 * 24 * 60 * 60 * 1_000)
        : input.from;
      await this.capture(sources, calls, 'list_services', projectId ?? null,
        { from: catalogFrom.toISOString(), to: input.to.toISOString(), limit: 100 },
        async () => ({
          resourceType: 'observed_telemetry_service',
          services: await this.eventAnalytics.listObservedServices(
            input.tenantId, { ...baseQuery, from: catalogFrom }, 100,
          ),
          note: 'Services are discovered from trace, request, and log telemetry; this is not a configured ownership catalog.',
        }),
        selectedProject ? `Observed services in ${selectedProject.name}` : 'Observed organization services');
    }

    if (/\bendpoints?\b.*\bservice\b|\bservice\b.*\bendpoints?\b/i.test(question)) {
      const service = extractServiceName(input.question);
      if (service) {
        await this.capture(sources, calls, 'list_service_endpoints', projectId ?? null,
          { service, from: input.from.toISOString(), to: input.to.toISOString(), limit: 50 },
          () => this.eventAnalytics.listServiceEndpoints(input.tenantId, service, baseQuery, 50),
          `Observed endpoints for ${service}`);
      }
    }

    const incidentIntent = /\bincidents?\b/i.test(question);
    if (incidentIntent) {
      const incidentId = extractUuid(input.question);
      if (incidentId) {
        await this.capture(sources, calls, 'get_incident', null, { incidentId },
          async () => ({
            resourceType: 'alert_event_incident_proxy',
            incident: await this.alerting.getEvent(input.tenantId, incidentId),
          }),
          `Incident proxy ${incidentId}`);
      } else if (/active|current|right now|unresolved|any incidents/i.test(question)) {
        await this.capture(sources, calls, 'list_active_incidents', null, { limit: 20 },
          async () => ({
            resourceType: 'alert_event_incident_proxy',
            ...(await this.alerting.listActiveEvents(input.tenantId, 20)),
            note: 'The platform currently models active operational incidents as active alert events.',
          }),
          'Active incident proxies');
      } else {
        const severity = /\bcritical\b/i.test(question) ? 'critical' : undefined;
        const rankByImpact = /\btop\b|most severe|longest/i.test(question);
        await this.capture(sources, calls, 'list_incidents', null,
          { from: input.from.toISOString(), to: input.to.toISOString(), limit: 20,
            ...(severity ? { severity } : {}), rankByImpact },
          async () => ({
            resourceType: 'alert_event_incident_proxy',
            ...(await this.alerting.listIncidentProxyEvents(
              input.tenantId, input.from, input.to, severity, 20, rankByImpact,
            )),
            note: 'The platform currently models operational incident history using alert events.',
          }),
          'Incident history proxies');
      }
    }

    if (/\balert|firing|alarm|page\b/i.test(question) && !incidentIntent) {
      await this.capture(sources, calls, 'list_alerts', null,
        { limit: 20, offset: 0, sortOrder: 'desc' },
        () => this.alerting.listEvents(input.tenantId, { limit: 20, offset: 0, sortOrder: 'desc' }),
        'Recent organization alert events');
    }

    if (selectedProject && /endpoint|route|api|slow|performance|dashboard|overview/i.test(question)) {
      const range = { from: input.from, to: input.to };
      await this.capture(sources, calls, 'get_endpoint_performance', selectedProject.id,
        { from: input.from.toISOString(), to: input.to.toISOString() },
        () => this.analytics.getDashboard(selectedProject.id, range),
        `Endpoint and error dashboard for ${selectedProject.name}`);
    }

    return { sources: sources.slice(0, 5), calls: calls.slice(0, 5) };
  }

  private async capture(
    sources: MonitoringSource[],
    calls: ChatToolCallRecord[],
    toolName: string,
    projectId: string | null,
    args: Record<string, unknown>,
    work: () => Promise<unknown>,
    title: string,
  ): Promise<void> {
    const started = Date.now();
    try {
      const result = boundedResult(await this.withTimeout(work(), 5_000));
      this.addResult(sources, calls, toolName, projectId, args, result, Date.now() - started, title);
    } catch (error) {
      calls.push({
        invocationId: randomUUID(), toolName, projectId, arguments: args,
        result: { error: 'Monitoring data query failed' }, durationMs: Date.now() - started, status: 'failed',
      });
      // A failed tool is audited but is never supplied as grounding evidence.
      void error;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Monitoring tool timed out')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private addResult(
    sources: MonitoringSource[],
    calls: ChatToolCallRecord[],
    toolName: string,
    projectId: string | null,
    args: Record<string, unknown>,
    result: unknown,
    durationMs: number,
    title: string,
  ): void {
    const invocationId = randomUUID();
    const observedAt = new Date().toISOString();
    calls.push({
      invocationId, toolName, projectId, arguments: args, result,
      durationMs, status: 'success',
    });
    sources.push({
      sourceId: `tool:${invocationId}`,
      sourceType: 'tool',
      title,
      reference: projectId ? `monitoring://projects/${projectId}/${toolName}` : `monitoring://organization/${toolName}`,
      content: stableStringify(result),
      observedAt,
    });
  }
}
