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
  projectPublicRow,
} from './query-engine/index.js';
import type { ExplorerResource, FacetDef } from './query-engine/index.js';
import { explorerRegistry } from './resources/index.js';
import { ObservabilityRepository } from './repository.js';
import { CorrelationEngine, type CorrelationBundle } from './correlation/engine.js';
import { AIInvestigator, type AIInvestigationResult } from './ai/investigator.js';
import { assembleContext, AI_INTENTS, type AIIntent } from './ai/context-assembler.js';
import type { TimelineInterval } from './query-engine/index.js';
import type { IssueLifecycleService, LifecycleOptions } from '../errors/services/issue-lifecycle.service.js';
import { LifecycleConflictError } from '../errors/services/issue-lifecycle.service.js';
import { errorsResource, requestsResource } from './resources/index.js';
import {
  assertRequestPublicId,
  assembleRequestDetail,
  assembleRequestDeveloperTools,
  type RequestDetailResponse,
  type RequestDeveloperToolsResponse,
  type RequestRelatedError,
} from './request-detail.js';
import {
  assertErrorPublicId,
  isErrorPublicId,
  assembleErrorDetail,
  type ErrorDetailResponse,
} from './error-detail.js';
import { assembleErrorGroupItem } from './error-group-assembler.js';

/** Lookback window for request-related errors and logs (±10 minutes). */
const REQUEST_RELATED_WINDOW_MS = 10 * 60 * 1000;

/** Lookback window for error-related logs and request lookup (±10 minutes). */
const ERROR_RELATED_WINDOW_MS = 10 * 60 * 1000;

export interface EventDetail {
  id?: string | undefined;
  publicId?: string | undefined;
  resource: string;
  entity: Record<string, unknown>;
  errorGroup?: { publicId: string | null } | null | undefined;
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
    private readonly lifecycle?: IssueLifecycleService,
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

  private async prepareQuery(name: string, ctx: QueryContext, rawQuery: unknown): Promise<ExplorerQuery> {
    const resource = this.resource(name);
    const query = buildExplorerQuery(rawQuery, resource.defaultSort);

    const projFilterIndex = query.filters.findIndex((f) => f.field === 'project' || f.field === 'projectSlug');
    if (projFilterIndex >= 0) {
      const val = String(query.filters[projFilterIndex]?.value ?? '').trim();
      query.filters.splice(projFilterIndex, 1);

      if (val) {
        const resolvedProjectId = await this.repository.resolveProjectIdFromSlug(ctx, val);
        const canAccessProject = resolvedProjectId && (
          ctx.allowedProjectIds === undefined || ctx.allowedProjectIds.includes(resolvedProjectId)
        );

        if (canAccessProject) {
          ctx.projectId = resolvedProjectId;
        } else {
          delete ctx.projectId;
          ctx.allowedProjectIds = [];
        }
      }
    }

    return query;
  }

  async list(name: string, ctx: QueryContext, rawQuery: unknown): Promise<ExplorerListResponse<Record<string, unknown>>> {
    const resource = this.resource(name);
    const query = await this.prepareQuery(name, ctx, rawQuery);

    if (name === 'error-groups') {
      const result = await this.engine.list(resource, ctx, query);

      const traceIds: string[] = [];
      const groupIds: string[] = [];
      for (const item of result.items) {
        const tId = String(item.last_trace_id ?? item.lastTraceId ?? '');
        if (tId) traceIds.push(tId);
        const gId = String(item.id ?? '');
        const pId = String(item.public_id ?? item.publicId ?? '');
        if (gId) groupIds.push(gId);
        if (pId) groupIds.push(pId);
      }

      const [tracePublicIdMap, eventPublicIdMap] = await Promise.all([
        this.repository.fetchTracePublicIdMap(ctx, traceIds),
        this.repository.fetchLatestEventPublicIdMap(ctx, groupIds),
      ]);

      const canonicalItems = result.items.map((row) =>
        assembleErrorGroupItem(row, tracePublicIdMap, eventPublicIdMap) as unknown as Record<string, unknown>,
      );

      return {
        ...result,
        items: canonicalItems,
      };
    }

    return this.engine.list(resource, ctx, query);
  }

  async summary(name: string, ctx: QueryContext, rawQuery: unknown): Promise<Record<string, number>> {
    const resource = this.resource(name);
    const query = await this.prepareQuery(name, ctx, rawQuery);
    return this.engine.summary(resource, ctx, query);
  }

  async statistics(name: string, ctx: QueryContext, rawQuery: unknown): Promise<Record<string, number | null>> {
    const resource = this.resource(name);
    const query = await this.prepareQuery(name, ctx, rawQuery);
    return this.engine.statistics(resource, ctx, query);
  }

  async timeline(
    name: string,
    ctx: QueryContext,
    rawQuery: unknown,
    interval: TimelineInterval,
  ): Promise<TimelineBucket[]> {
    const resource = this.resource(name);
    const query = await this.prepareQuery(name, ctx, rawQuery);
    return this.engine.timeline(resource, ctx, query, interval);
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

    const entity = projectPublicRow(resource, resource.mapRow(raw) as Record<string, unknown>);

    const rawId = (raw.id as string | undefined) ?? (entity.id as string | undefined);
    const rawPublicId = (raw.public_id as string | undefined) ?? (raw.publicId as string | undefined) ?? (entity.publicId as string | undefined);

    const tracePubId = (bundle.trace?.publicId ?? bundle.trace?.public_id ?? entity.tracePublicId ?? raw.trace_public_id ?? raw.tracePublicId) as string | undefined;
    const traceId = (bundle.trace?.traceId ?? bundle.trace?.trace_id ?? entity.traceId ?? raw.trace_id ?? raw.traceId) as string | undefined;

    if (tracePubId) {
      entity.tracePublicId = tracePubId;
    }
    if (tracePubId || traceId) {
      entity.trace = {
        ...(typeof entity.trace === 'object' && entity.trace ? (entity.trace as Record<string, unknown>) : {}),
        ...(tracePubId ? { publicId: tracePubId } : {}),
        ...(traceId ? { traceId } : {}),
      };
    }

    let errorGroupObj: { publicId: string } | null = null;
    let errorGroupPubId = (entity.errorGroupPublicId ?? raw.error_group_public_id ?? raw.errorGroupPublicId) as string | undefined;
    if (!errorGroupPubId && name === 'errors') {
      const groupId = (raw.error_group_id ?? raw.errorGroupId) as string | null;
      const fp = raw.fingerprint as string | null;
      if (groupId || fp) {
        errorGroupPubId = (await this.repository.fetchErrorGroupPublicId(ctx, groupId, fp)) ?? undefined;
      }
    }
    if (errorGroupPubId) {
      entity.errorGroupPublicId = errorGroupPubId;
      errorGroupObj = { publicId: errorGroupPubId };
      entity.errorGroup = errorGroupObj;
    }

    const traceReturn: Record<string, unknown> | null = bundle.trace
      ? {
          ...bundle.trace,
          ...(tracePubId ? { publicId: tracePubId } : {}),
          ...(traceId ? { traceId } : {}),
        }
      : (tracePubId || traceId)
      ? {
          ...(tracePubId ? { publicId: tracePubId } : {}),
          ...(traceId ? { traceId } : {}),
        }
      : null;

    const parseJson = (val: unknown): unknown => {
      if (!val) return null;
      if (typeof val === 'string') {
        try {
          return JSON.parse(val);
        } catch {
          return val;
        }
      }
      return val;
    };

    return {
      id: rawId,
      publicId: rawPublicId,
      resource: name,
      entity,
      errorGroup: errorGroupObj,
      attributes: parseJson(raw.attributes ?? raw.span_attributes ?? entity.attributes),
      metadata: parseJson(raw.metadata ?? raw.event_metadata ?? entity.metadata),
      payload: parseJson(raw.payload ?? raw.event_payload ?? entity.payload),
      trace: traceReturn,
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

  /**
   * Dedicated request-event detail.
   *
   * Returns the sectioned payload the request detail page expects. All data is
   * fetched with bounded, indexed lookups:
   *   - the request itself by public_id (unique index)
   *   - related logs: COUNT only, via trace_id / request_id + time window
   *   - related errors: lightweight public_id + message, capped at 20
   *   - trace public id: single-row lookup by trace_id
   */
  async detailRequest(ctx: QueryContext, id: string): Promise<RequestDetailResponse> {
    assertRequestPublicId(id);
    const raw = await this.repository.fetchRawById(requestsResource, ctx, id);
    if (!raw) throw new ExplorerNotFoundError('Request event');

    const center = raw.occurred_at instanceof Date
      ? raw.occurred_at
      : new Date(String(raw.occurred_at ?? Date.now()));
    if (Number.isNaN(center.getTime())) {
      throw new ExplorerNotFoundError('Request event');
    }
    const from = new Date(center.getTime() - REQUEST_RELATED_WINDOW_MS);
    const to = new Date(center.getTime() + REQUEST_RELATED_WINDOW_MS);

    const traceId = typeof raw.trace_id === 'string' && raw.trace_id.length > 0 ? raw.trace_id : null;
    const requestId = typeof raw.request_id === 'string' && raw.request_id.length > 0 ? raw.request_id : null;
    const rawTracePublicId =
      (typeof raw.tracePublicId === 'string' && raw.tracePublicId.length > 0 ? raw.tracePublicId : null)
      ?? (typeof raw.trace_public_id === 'string' && raw.trace_public_id.length > 0 ? raw.trace_public_id : null);

    const [relatedErrors, logsCount, spanCount, tracePublicId] = await Promise.all([
      this.repository.fetchRelatedErrors(ctx, traceId, requestId, from, to, 20),
      this.repository.countRelatedLogs(ctx, traceId, requestId, from, to),
      this.repository.countRelatedSpans(ctx, traceId, requestId, from, to),
      rawTracePublicId ? Promise.resolve(rawTracePublicId) : this.repository.fetchTracePublicId(ctx, traceId),
    ]);

    return assembleRequestDetail(raw, {
      relatedErrors: relatedErrors as RequestRelatedError[],
      logsCount,
      spanCount,
      tracePublicId,
    });
  }

  /**
   * Lazy raw dumps for the Developer Tools accordion on request detail.
   * Not included in the canonical detail response — fetch only when expanded.
   */
  async requestDeveloperTools(ctx: QueryContext, id: string): Promise<RequestDeveloperToolsResponse> {
    assertRequestPublicId(id);
    const raw = await this.repository.fetchRawById(requestsResource, ctx, id);
    if (!raw) throw new ExplorerNotFoundError('Request event');
    return assembleRequestDeveloperTools(raw);
  }

  /**
   * Dedicated error-event detail.
   *
   * Returns the structured payload the error detail page expects. All data is
   * fetched with bounded, indexed lookups:
   *   - the error itself by public_id (unique index)
   *   - related logs: COUNT only, via trace_id / request_id + time window
   *   - trace public id: single-row lookup by trace_id
   *   - request public id: single-row lookup by request_id / event_id
   *   - error group public id: single-row lookup by error_group_id / fingerprint
   */
  async detailError(ctx: QueryContext, id: string): Promise<ErrorDetailResponse> {
    let raw: Record<string, unknown> | null = null;
    if (isErrorPublicId(id)) {
      raw = await this.repository.fetchRawById(errorsResource, ctx, id);
    } else if (id.toUpperCase().startsWith('ISS-')) {
      raw = await this.repository.fetchLatestErrorForGroup(ctx, id);
    } else {
      raw = await this.repository.fetchRawById(errorsResource, ctx, id);
      if (!raw) {
        raw = await this.repository.fetchLatestErrorForGroup(ctx, id);
      }
    }
    if (!raw) throw new ExplorerNotFoundError('Error event');

    const center = raw.occurred_at instanceof Date
      ? raw.occurred_at
      : new Date(String(raw.occurred_at ?? Date.now()));
    if (Number.isNaN(center.getTime())) {
      throw new ExplorerNotFoundError('Error event');
    }
    const from = new Date(center.getTime() - ERROR_RELATED_WINDOW_MS);
    const to = new Date(center.getTime() + ERROR_RELATED_WINDOW_MS);

    const traceId = typeof raw.trace_id === 'string' && raw.trace_id.length > 0 ? raw.trace_id : null;
    const requestId = typeof raw.request_id === 'string' && raw.request_id.length > 0 ? raw.request_id : null;
    const rawTracePublicId =
      (typeof raw.tracePublicId === 'string' && raw.tracePublicId.length > 0 ? raw.tracePublicId : null)
      ?? (typeof raw.trace_public_id === 'string' && raw.trace_public_id.length > 0 ? raw.trace_public_id : null);
    const rawErrorGroupPublicId =
      (typeof raw.errorGroupPublicId === 'string' && raw.errorGroupPublicId.length > 0 ? raw.errorGroupPublicId : null)
      ?? (typeof raw.error_group_public_id === 'string' && raw.error_group_public_id.length > 0 ? raw.error_group_public_id : null);

    const [logsCount, tracePublicId, requestPublicId, errorGroupPublicId] = await Promise.all([
      this.repository.countRelatedLogs(ctx, traceId, requestId, from, to),
      rawTracePublicId ? Promise.resolve(rawTracePublicId) : this.repository.fetchTracePublicId(ctx, traceId),
      this.repository.fetchRequestPublicId(ctx, requestId, from, to),
      rawErrorGroupPublicId
        ? Promise.resolve(rawErrorGroupPublicId)
        : this.repository.fetchErrorGroupPublicId(
            ctx,
            typeof raw.error_group_id === 'string' && raw.error_group_id.length > 0 ? raw.error_group_id : null,
            typeof raw.fingerprint === 'string' && raw.fingerprint.length > 0 ? raw.fingerprint : null,
          ),
    ]);

    return assembleErrorDetail(raw, {
      logsCount,
      tracePublicId,
      requestPublicId,
      errorGroupPublicId,
    });
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

    const mapped = projectPublicRow(resource, resource.mapRow(raw) as Record<string, unknown>);
    const fingerprint = String(raw.fingerprint ?? '');
    const traceId = String(raw.last_trace_id ?? raw.lastTraceId ?? '');
    const gId = String(raw.id ?? '');
    const pId = String(raw.public_id ?? raw.publicId ?? '');

    const [sample, trends, tracePublicIdMap, eventPublicIdMap] = await Promise.all([
      this.repository.getErrorGroupStackFrames(ctx, groupId, fingerprint),
      this.repository.getErrorGroupTrends(ctx, groupId, fingerprint),
      traceId ? this.repository.fetchTracePublicIdMap(ctx, [traceId]) : Promise.resolve(new Map<string, string>()),
      this.repository.fetchLatestEventPublicIdMap(ctx, [gId, pId].filter(Boolean)),
    ]);

    const canonical = assembleErrorGroupItem(raw, tracePublicIdMap, eventPublicIdMap);
    const firstSeen = raw.first_seen_at ?? raw.firstSeen ?? raw.created_at;
    const lastSeen = raw.last_seen_at ?? raw.lastSeen ?? raw.updated_at;
    const occurrenceCount = Number(raw.occurrence_count ?? raw.occurrenceCount ?? 1);
    const regressionCount = Number(raw.regression_count ?? raw.regressionCount ?? 0);

    return {
      ...canonical,
      ...mapped,
      id: raw.id,
      publicId: raw.public_id ?? raw.publicId ?? null,
      fingerprint: raw.fingerprint,
       status: String(raw.status ?? 'OPEN').toUpperCase(),
      occurrenceCount,
      firstSeen,
      firstSeenAt: firstSeen,
      lastSeen,
      lastSeenAt: lastSeen,
      highestSeverity: (raw.highest_severity ?? raw.highestSeverity ?? 'error').toString().toLowerCase(),
      latestSeverity: (raw.latest_severity ?? raw.latestSeverity ?? 'error').toString().toLowerCase(),
       isRegression: regressionCount > 0 && (raw.last_regressed_at ?? raw.lastRegressedAt) != null,
      regressionCount,
      lastRegressedAt: raw.last_regressed_at ?? raw.lastRegressedAt ?? null,
      fingerprintVersion: Number(raw.fingerprint_version ?? raw.fingerprintVersion ?? 1),
      resolvedAt: raw.resolved_at ?? raw.resolvedAt ?? null,
      resolvedRelease: raw.resolved_release ?? raw.resolvedRelease ?? null,
      latestEnvironment: raw.latest_environment ?? raw.latestEnvironment ?? null,
      latestService: raw.latest_service ?? raw.latestService ?? null,
      version: Number(raw.version ?? 1),
      latestRelease: raw.latest_release ?? raw.latestRelease ?? null,
      latestSdkVersion: raw.latest_sdk_version ?? raw.latestSdkVersion ?? null,
      latestApplicationVersion: raw.latest_application_version ?? raw.latestApplicationVersion ?? null,
      lastErrorMessage: raw.last_error_message ?? raw.lastErrorMessage ?? '',
      lastErrorName: raw.last_error_name ?? raw.lastErrorName ?? 'Error',
      lastStatusCode: sample?.statusCode ?? raw.last_status_code ?? raw.lastStatusCode ?? null,
      lastTraceId: sample?.traceId ?? raw.last_trace_id ?? raw.lastTraceId ?? null,
      lastRequestId: raw.last_request_id ?? raw.lastRequestId ?? null,
      isMerged: Boolean(raw.is_merged ?? raw.isMerged),
      mergedInto: raw.merged_into ?? raw.mergedInto ?? null,
      stackFrames: sample?.stackFrames ?? [],
      route: sample?.route ?? raw.route ?? '',
      traceId: sample?.traceId ?? raw.last_trace_id ?? raw.lastTraceId ?? null,
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

  /** Update error group status through the canonical lifecycle service. */
  async updateErrorGroupStatus(
    ctx: QueryContext,
    groupId: string,
    status: string,
    comment?: string,
    expectedVersion?: number,
    release?: string | null,
  ): Promise<Record<string, unknown>> {
    if (!this.lifecycle) throw new Error('ERROR_GROUP_LIFECYCLE_UNAVAILABLE');
    const projectId = await this.resolveGroupProject(ctx, groupId);
    const normalized = status.toUpperCase();
    const options: LifecycleOptions = {
      ...(ctx.userId ? { actorId: ctx.userId } : {}),
      ...(comment ? { reason: comment } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      ...(release !== undefined ? { release } : {}),
    };
    if (normalized === 'RESOLVED') await this.lifecycle.resolve(projectId, groupId, options);
    else if (normalized === 'IGNORED') await this.lifecycle.ignore(projectId, groupId, options);
    else if (normalized === 'ARCHIVED') await this.lifecycle.archive(projectId, groupId, options);
    else if (normalized === 'OPEN') await this.lifecycle.reopen(projectId, groupId, options);
    else throw new Error(`INVALID_ERROR_GROUP_STATUS:${status}`);
    return this.getErrorGroupFullDetail(ctx, groupId);
  }

  /** Merge source error group into target group through the canonical lifecycle service. */
  async mergeErrorGroup(
    ctx: QueryContext,
    sourceGroupId: string,
    targetGroupId: string,
    reason?: string,
    expectedVersion?: number,
  ): Promise<Record<string, unknown>> {
    if (!this.lifecycle) throw new Error('ERROR_GROUP_LIFECYCLE_UNAVAILABLE');
    const projectId = await this.resolveGroupProject(ctx, sourceGroupId);
    await this.lifecycle.merge(projectId, sourceGroupId, targetGroupId, {
      ...(ctx.userId ? { actorId: ctx.userId } : {}),
      ...(reason ? { reason } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
    return this.getErrorGroupFullDetail(ctx, targetGroupId);
  }

  async unmergeErrorGroup(
    ctx: QueryContext,
    groupId: string,
    reason?: string,
    expectedVersion?: number,
  ): Promise<Record<string, unknown>> {
    if (!this.lifecycle) throw new Error('ERROR_GROUP_LIFECYCLE_UNAVAILABLE');
    const projectId = await this.resolveGroupProject(ctx, groupId);
    await this.lifecycle.unmerge(projectId, groupId, {
      ...(ctx.userId ? { actorId: ctx.userId } : {}),
      ...(reason ? { reason } : {}),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
    });
    return this.getErrorGroupFullDetail(ctx, groupId);
  }

  private async resolveGroupProject(ctx: QueryContext, groupId: string): Promise<string> {
    const raw = await this.repository.fetchRawById(this.resource('error-groups'), ctx, groupId);
    if (!raw) throw new ExplorerNotFoundError('Error Group');
    const projectId = String(raw.project_id ?? '');
    if (!projectId || (ctx.allowedProjectIds && !ctx.allowedProjectIds.includes(projectId))) {
      throw new ExplorerNotFoundError('Error Group');
    }
    return projectId;
  }
}
