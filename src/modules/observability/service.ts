/**
 * Observability service — the module's application layer.
 *
 * Every explorer capability funnels through here: list/summary/statistics/
 * timeline (via the Unified Explorer Query Engine), universal event detail
 * (via the Correlation Engine), and AI investigation (via the assembler +
 * investigator). Controllers stay thin; nothing here builds SQL by hand.
 */
import type {
  ExplorerListResponse,
  ExplorerQuery,
  FilterClause,
  QueryContext,
  TimelineBucket,
} from './query-engine/index.js';
import {
  ExplorerQueryEngine,
  ExplorerNotFoundError,
  UnknownResourceError,
  buildExplorerQuery,
  buildFacets,
} from './query-engine/index.js';
import type { ExplorerResource, FacetDef } from './query-engine/index.js';
import { explorerRegistry } from './resources/index.js';
import { ObservabilityRepository } from './repository.js';
import { CorrelationEngine, type CorrelationBundle } from './correlation/engine.js';
import { AIInvestigator, type AIInvestigationResult } from './ai/investigator.js';
import { assembleContext, AI_INTENTS, type AIIntent } from './ai/context-assembler.js';
import type { TimelineInterval } from './query-engine/index.js';

export interface EventDetail {
  resource: string;
  entity: Record<string, unknown>;
  attributes: unknown;
  metadata: unknown;
  payload: unknown;
  trace: Record<string, unknown> | null;
  spanTree: unknown;
  spans: Array<Record<string, unknown>>;
  logs: Array<Record<string, unknown>>;
  relatedErrors: Array<Record<string, unknown>>;
  relatedRequests: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  crons: Array<Record<string, unknown>>;
  correlations: CorrelationBundle['keys'];
  counts: Record<string, number>;
  timeline: TimelineBucket[];
  aiContext: { intents: readonly AIIntent[]; facts: string[] };
}

export interface NavNode {
  label: string;
  route: string;
  resource?: string;
  live?: boolean;
  children?: NavNode[];
}

export class ObservabilityService {
  private readonly engine: ExplorerQueryEngine;

  constructor(
    private readonly repository: ObservabilityRepository,
    private readonly correlation: CorrelationEngine,
    private readonly investigator: AIInvestigator,
  ) {
    this.engine = new ExplorerQueryEngine(repository);
  }

  /** Resolve a resource by name, failing closed on unknown names. */
  private resource(name: string): ExplorerResource {
    const resource = explorerRegistry.get(name);
    if (!resource) throw new UnknownResourceError(name);
    return resource;
  }

  /** List of explorer resource names (for discovery/health). */
  resourceNames(): string[] {
    return explorerRegistry.names();
  }

  /** Toolbar facet metadata for a resource (available filters). */
  facets(name: string): FacetDef[] {
    return buildFacets(this.resource(name));
  }

  async list(name: string, ctx: QueryContext, rawQuery: unknown): Promise<ExplorerListResponse<Record<string, unknown>>> {
    const resource = this.resource(name);
    const query = buildExplorerQuery(rawQuery, resource.defaultSort);
    return this.engine.list(resource, ctx, query);
  }

  async summary(name: string, ctx: QueryContext, rawQuery: unknown): Promise<Record<string, number>> {
    const resource = this.resource(name);
    return this.engine.summary(resource, ctx, buildExplorerQuery(rawQuery, resource.defaultSort));
  }

  async statistics(name: string, ctx: QueryContext, rawQuery: unknown): Promise<Record<string, number | null>> {
    const resource = this.resource(name);
    return this.engine.statistics(resource, ctx, buildExplorerQuery(rawQuery, resource.defaultSort));
  }

  async timeline(
    name: string,
    ctx: QueryContext,
    rawQuery: unknown,
    interval: TimelineInterval,
  ): Promise<TimelineBucket[]> {
    const resource = this.resource(name);
    return this.engine.timeline(resource, ctx, buildExplorerQuery(rawQuery, resource.defaultSort), interval);
  }

  /**
   * Live tail: rows newer than `since` for the current filter set, ascending.
   * Backs the SSE stream — a bounded poll, no Redis pub/sub dependency.
   */
  async pollSince(
    name: string,
    ctx: QueryContext,
    rawQuery: unknown,
    since: Date,
    max = 200,
  ): Promise<Array<Record<string, unknown>>> {
    const resource = this.resource(name);
    const base = buildExplorerQuery(rawQuery, resource.defaultSort);
    const query: ExplorerQuery = {
      ...base,
      filters: [...base.filters, { field: 'occurredAt', op: 'gt', value: since.toISOString() }],
      timeRange: { from: since, to: new Date(Date.now() + 60_000) },
      sort: { field: 'occurredAt', direction: 'asc' },
      direction: 'forward',
      limit: max,
      live: true,
    };
    const result = await this.engine.list(resource, ctx, query);
    return result.items;
  }

  /** Universal event detail: one correlated payload; the frontend joins nothing. */
  async detail(name: string, ctx: QueryContext, id: string): Promise<EventDetail> {
    const resource = this.resource(name);
    const raw = await this.repository.fetchRawById(resource, ctx, id);
    if (!raw) throw new ExplorerNotFoundError(`${name} event`);

    const bundle = await this.correlation.correlate(name, ctx, raw);
    const timeline = await this.detailTimeline(name, ctx, raw);
    const facts = assembleContext(name, raw, bundle, timeline).facts;

    return {
      resource: name,
      entity: resource.mapRow(raw),
      attributes: raw.attributes ?? null,
      metadata: raw.metadata ?? null,
      payload: raw.payload ?? null,
      trace: bundle.trace,
      spanTree: bundle.spanTree,
      spans: bundle.spans,
      logs: bundle.logs,
      relatedErrors: bundle.relatedErrors,
      relatedRequests: bundle.relatedRequests,
      metrics: bundle.metrics,
      profiles: bundle.profiles,
      crons: bundle.crons,
      correlations: bundle.keys,
      counts: bundle.counts,
      timeline,
      aiContext: { intents: AI_INTENTS, facts },
    };
  }

  /** Related events of one type for a detail page's lazy relationship tabs. */
  async related(
    name: string,
    ctx: QueryContext,
    id: string,
    relation: string,
  ): Promise<Array<Record<string, unknown>>> {
    const resource = this.resource(name);
    const raw = await this.repository.fetchRawById(resource, ctx, id);
    if (!raw) throw new ExplorerNotFoundError(`${name} event`);
    const bundle = await this.correlation.correlate(name, ctx, raw);
    switch (relation) {
      case 'spans': return bundle.spans;
      case 'logs': return bundle.logs;
      case 'errors': return bundle.relatedErrors;
      case 'requests': return bundle.relatedRequests;
      case 'metrics': return bundle.metrics;
      case 'profiles': return bundle.profiles;
      case 'crons': return bundle.crons;
      default: return [];
    }
  }

  /** AI investigation for a single event (Explain / Root Cause / …). */
  async askEvent(
    name: string,
    ctx: QueryContext,
    id: string,
    intent: AIIntent,
    question?: string,
  ): Promise<AIInvestigationResult> {
    const resource = this.resource(name);
    const raw = await this.repository.fetchRawById(resource, ctx, id);
    if (!raw) throw new ExplorerNotFoundError(`${name} event`);
    const bundle = await this.correlation.correlate(name, ctx, raw);
    const timeline = await this.detailTimeline(name, ctx, raw);
    const context = assembleContext(name, raw, bundle, timeline);
    return this.investigator.investigate(context, intent, question);
  }

  /**
   * AI investigation over a filtered result set (Ask AI from the toolbar).
   * The context is built from summary + statistics + a sample, so the model
   * reasons over the aggregate rather than a single row.
   */
  async askList(
    name: string,
    ctx: QueryContext,
    rawQuery: unknown,
    intent: AIIntent,
    question?: string,
  ): Promise<AIInvestigationResult> {
    const resource = this.resource(name);
    const query = buildExplorerQuery(rawQuery, resource.defaultSort);
    const [listed, summary, statistics, timeline] = await Promise.all([
      this.engine.list(resource, ctx, { ...query, limit: 20 }),
      this.engine.summary(resource, ctx, query),
      this.engine.statistics(resource, ctx, query),
      this.engine.timeline(resource, ctx, query, 'hour'),
    ]);
    const seed: Record<string, unknown> = {
      resource: name,
      summary,
      statistics,
      sample: listed.items.slice(0, 10),
      timestamp: new Date().toISOString(),
    };
    const bundle: CorrelationBundle = {
      keys: { traceId: null, requestId: null, spanId: null, sessionId: null, userId: null },
      trace: null,
      spanTree: null,
      spans: [],
      logs: [],
      relatedErrors: [],
      relatedRequests: [],
      metrics: [],
      profiles: [],
      crons: [],
      counts: { errors: 0, logs: 0, spans: 0, requests: 0, metrics: 0, profiles: 0, crons: 0 },
    };
    const context = assembleContext(name, seed, bundle, timeline);
    // Enrich facts with aggregate signal.
    context.facts.push(`Result set summary: ${JSON.stringify(summary)}`);
    context.facts.push(`Result set statistics: ${JSON.stringify(statistics)}`);
    return this.investigator.investigate(context, intent, question);
  }

  /**
   * Bulk AI investigation for a selected array of row IDs or filtered result set.
   */
  async analyzeBulk(
    name: string,
    ctx: QueryContext,
    body: {
      selectionMode?: 'selected' | 'filtered' | undefined;
      selectedIds?: string[] | undefined;
      selectAll?: boolean | undefined;
      filters?: Record<string, unknown> | undefined;
      search?: string | undefined;
      timeRange?: unknown;
      prompt?: string | undefined;
      intent?: AIIntent | undefined;
    },
  ): Promise<AIInvestigationResult> {
    const resource = this.resource(name);
    let sample: Array<Record<string, unknown>> = [];
    let summary: Record<string, number> = {};
    let statistics: Record<string, number | null> = {};

    const isSelectedMode = body.selectionMode === 'selected' && body.selectedIds && body.selectedIds.length > 0 && !body.selectAll;

    if (isSelectedMode && body.selectedIds && body.selectedIds.length <= 100) {
      sample = await this.repository.fetchRawByIds(resource, ctx, body.selectedIds);
      summary = { selectedCount: sample.length };
    } else {
      const rawQuery = {
        filters: body.filters,
        search: body.search,
        timeRange: body.timeRange,
      };
      const query = buildExplorerQuery(rawQuery, resource.defaultSort);
      const [listed, sum, stats] = await Promise.all([
        this.engine.list(resource, ctx, { ...query, limit: 50 }),
        this.engine.summary(resource, ctx, query).catch(() => ({})),
        this.engine.statistics(resource, ctx, query).catch(() => ({})),
      ]);
      sample = listed.items;
      summary = sum;
      statistics = stats;
    }

    const promptText = body.prompt ?? "Summarize key issues and findings across selected items";
    const seed: Record<string, unknown> = {
      resource: name,
      selectionMode: body.selectionMode ?? (isSelectedMode ? 'selected' : 'filtered'),
      selectedCount: body.selectedIds?.length ?? 0,
      summary,
      statistics,
      sample: sample.slice(0, 20),
      userPrompt: promptText,
      timestamp: new Date().toISOString(),
    };

    const bundle: CorrelationBundle = {
      keys: { traceId: null, requestId: null, spanId: null, sessionId: null, userId: null },
      trace: null,
      spanTree: null,
      spans: [],
      logs: [],
      relatedErrors: [],
      relatedRequests: [],
      metrics: [],
      profiles: [],
      crons: [],
      counts: { errors: 0, logs: 0, spans: 0, requests: 0, metrics: 0, profiles: 0, crons: 0 },
    };

    const context = assembleContext(name, seed, bundle, []);
    context.facts.push(`Selection Mode: ${body.selectionMode ?? 'filtered'}`);
    if (body.prompt) context.facts.push(`User Question: ${body.prompt}`);
    context.facts.push(`Analyzed ${sample.length} records: ${JSON.stringify(sample.slice(0, 10))}`);

    return this.investigator.investigate(context, body.intent ?? 'explain', promptText);
  }

  /**
   * Detail timeline: occurrence trend for the event's natural group key over a
   * bounded window around the event. Errors group by fingerprint, requests by
   * route; other resources return an empty trend (their detail is point-in-time).
   */
  private async detailTimeline(
    name: string,
    ctx: QueryContext,
    raw: Record<string, unknown>,
  ): Promise<TimelineBucket[]> {
    const filters = this.groupFilter(name, raw);
    if (filters.length === 0) return [];
    const resource = this.resource(name);
    const rawTime = raw.occurred_at ?? raw.timestamp;
    const center = rawTime instanceof Date ? rawTime : new Date(String(rawTime));
    const anchor = Number.isNaN(center.getTime()) ? new Date() : center;
    const query: ExplorerQuery = {
      timeRange: { from: new Date(anchor.getTime() - 24 * 60 * 60 * 1000), to: new Date(anchor.getTime() + 60 * 60 * 1000) },
      filters,
      sort: resource.defaultSort,
      direction: 'forward',
      limit: 1,
      live: false,
    };
    return this.engine.timeline(resource, ctx, query, 'hour');
  }

  private groupFilter(name: string, raw: Record<string, unknown>): FilterClause[] {
    if (name === 'errors' && typeof raw.fingerprint === 'string' && raw.fingerprint.length > 0) {
      return [{ field: 'fingerprint', op: 'eq', value: raw.fingerprint }];
    }
    if (name === 'requests' && typeof raw.route === 'string' && raw.route.length > 0) {
      return [{ field: 'route', op: 'eq', value: raw.route }];
    }
    if (name === 'crons' && typeof raw.monitor_slug === 'string' && raw.monitor_slug.length > 0) {
      return [{ field: 'monitorSlug', op: 'eq', value: raw.monitor_slug }];
    }
    return [];
  }

  /** Sidebar / information architecture (Phase 1). */
  getNavigation(): NavNode[] {
    return [
      { label: 'Overview', route: '/observability/overview' },
      {
        label: 'Live',
        route: '/observability/live',
        children: [
          { label: 'Requests', route: '/observability/live/requests', resource: 'requests', live: true },
          { label: 'Errors', route: '/observability/live/errors', resource: 'errors', live: true },
          { label: 'Logs', route: '/observability/live/logs', resource: 'logs', live: true },
          { label: 'Traces', route: '/observability/live/traces', resource: 'traces', live: true },
          { label: 'Spans', route: '/observability/live/spans', resource: 'spans', live: true },
          { label: 'Metrics', route: '/observability/live/metrics', resource: 'metrics', live: true },
          { label: 'Cron Check-ins', route: '/observability/live/crons', resource: 'crons', live: true },
          { label: 'Profiles', route: '/observability/live/profiles', resource: 'profiles', live: true },
        ],
      },
      {
        label: 'Explore',
        route: '/observability/explore',
        children: [
          { label: 'Requests', route: '/observability/requests', resource: 'requests' },
          { label: 'Errors', route: '/observability/errors', resource: 'errors' },
          { label: 'Logs', route: '/observability/logs', resource: 'logs' },
          { label: 'Traces', route: '/observability/traces', resource: 'traces' },
          { label: 'Spans', route: '/observability/spans', resource: 'spans' },
          { label: 'Metrics', route: '/observability/metrics', resource: 'metrics' },
          { label: 'Cron Check-ins', route: '/observability/crons', resource: 'crons' },
          { label: 'Profiles', route: '/observability/profiles', resource: 'profiles' },
        ],
      },
      {
        label: 'Analytics',
        route: '/observability/analytics',
        children: [
          { label: 'Dashboard', route: '/observability/analytics/dashboard' },
          { label: 'Services', route: '/observability/analytics/services' },
          { label: 'Endpoints', route: '/observability/analytics/endpoints' },
          { label: 'Databases', route: '/observability/analytics/databases' },
          { label: 'External APIs', route: '/observability/analytics/external' },
          { label: 'AI Insights', route: '/observability/analytics/ai-insights' },
          { label: 'Correlations', route: '/observability/analytics/correlations' },
          { label: 'Trends', route: '/observability/analytics/trends' },
        ],
      },
      { label: 'Deployments', route: '/observability/deployments' },
      { label: 'Releases', route: '/observability/releases' },
      { label: 'Alerting', route: '/observability/alerting' },
      { label: 'Settings', route: '/observability/settings' },
    ];
  }

  /**
   * Rich detail for an Error Group including latest stack frames and trends (24h, 7d, 30d).
   */
  async getErrorGroupFullDetail(ctx: QueryContext, groupId: string): Promise<Record<string, unknown>> {
    const resource = this.resource('error-groups');
    const raw = await this.repository.fetchRawById(resource, ctx, groupId);
    if (!raw) throw new ExplorerNotFoundError('Error Group');

    const mapped = resource.mapRow(raw);
    const fingerprint = String(raw.fingerprint ?? '');

    const [sample, trends] = await Promise.all([
      this.repository.getErrorGroupStackFrames(ctx, groupId, fingerprint),
      this.repository.getErrorGroupTrends(ctx, groupId, fingerprint),
    ]);

    const firstSeen = raw.first_seen_at ?? raw.firstSeen ?? raw.created_at;
    const lastSeen = raw.last_seen_at ?? raw.lastSeen ?? raw.updated_at;
    const occurrenceCount = Number(raw.occurrence_count ?? raw.occurrenceCount ?? 1);
    const regressionCount = Number(raw.regression_count ?? raw.regressionCount ?? 0);

    return {
      ...mapped,
      id: raw.id,
      fingerprint: raw.fingerprint,
      status: String(raw.status ?? 'OPEN').toLowerCase(),
      occurrenceCount,
      occurrence_count: occurrenceCount,
      firstSeen,
      firstSeenAt: firstSeen,
      first_seen_at: firstSeen,
      lastSeen,
      lastSeenAt: lastSeen,
      last_seen_at: lastSeen,
      highestSeverity: (raw.highest_severity ?? raw.highestSeverity ?? 'error').toString().toLowerCase(),
      latestSeverity: (raw.latest_severity ?? raw.latestSeverity ?? 'error').toString().toLowerCase(),
      isRegression: Boolean(raw.is_regression ?? raw.isRegression),
      regressionCount,
      lastRegressedAt: raw.last_regressed_at ?? raw.lastRegressedAt ?? null,
      latestRelease: raw.latest_release ?? raw.latestRelease ?? 'v1.0.0',
      latestSdkVersion: raw.latest_sdk_version ?? raw.latestSdkVersion ?? '1.0.0',
      latestApplicationVersion: raw.latest_application_version ?? raw.latestApplicationVersion ?? '1.0.0',
      lastErrorMessage: raw.last_error_message ?? raw.lastErrorMessage ?? '',
      lastErrorName: raw.last_error_name ?? raw.lastErrorName ?? 'Error',
      lastStatusCode: sample?.statusCode ?? raw.last_status_code ?? raw.lastStatusCode ?? 500,
      lastTraceId: sample?.traceId ?? raw.last_trace_id ?? raw.lastTraceId ?? '',
      lastRequestId: raw.last_request_id ?? raw.lastRequestId ?? '',
      isMerged: Boolean(raw.is_merged ?? raw.isMerged),
      mergedInto: raw.merged_into ?? raw.mergedInto ?? null,
      stackFrames: sample?.stackFrames ?? [],
      route: sample?.route ?? raw.route ?? '',
      traceId: sample?.traceId ?? raw.last_trace_id ?? raw.lastTraceId ?? '',
      trend24h: trends.trend24h,
      trend7d: trends.trend7d,
      trend30d: trends.trend30d,
    };
  }

  /** Fetch audit timeline history for an error group. */
  async getErrorGroupHistory(ctx: QueryContext, groupId: string): Promise<Array<Record<string, unknown>>> {
    return this.repository.getErrorGroupHistory(ctx, groupId);
  }

  /** Fetch related telemetry error events for an error group. */
  async getErrorGroupEvents(ctx: QueryContext, groupId: string, limit = 50): Promise<Array<Record<string, unknown>>> {
    const resource = this.resource('error-groups');
    const raw = await this.repository.fetchRawById(resource, ctx, groupId);
    const fingerprint = raw ? String(raw.fingerprint ?? '') : undefined;
    return this.repository.getRelatedErrorEvents(ctx, groupId, fingerprint, limit);
  }

  /** Update error group status with audit logging. */
  async updateErrorGroupStatus(
    ctx: QueryContext,
    groupId: string,
    status: string,
    comment?: string,
  ): Promise<Record<string, unknown>> {
    const actorId = ctx.userId ?? 'system';
    const updated = await this.repository.updateErrorGroupStatus(ctx, groupId, status, actorId, comment);
    if (!updated) throw new ExplorerNotFoundError('Error Group');
    const resource = this.resource('error-groups');
    return resource.mapRow(updated);
  }

  /** Merge source error group into target error group. */
  async mergeErrorGroup(
    ctx: QueryContext,
    sourceGroupId: string,
    targetGroupId: string,
  ): Promise<Record<string, unknown>> {
    const actorId = ctx.userId ?? 'system';
    const updated = await this.repository.mergeErrorGroups(ctx, sourceGroupId, targetGroupId, actorId);
    if (!updated) throw new ExplorerNotFoundError('Error Group target or source');
    const resource = this.resource('error-groups');
    return resource.mapRow(updated);
  }
}
