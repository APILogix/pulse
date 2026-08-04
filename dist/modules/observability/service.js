import { ExplorerQueryEngine, ExplorerNotFoundError, UnknownResourceError, buildExplorerQuery, buildFacets, } from './query-engine/index.js';
import { explorerRegistry } from './resources/index.js';
import { ObservabilityRepository } from './repository.js';
import { CorrelationEngine } from './correlation/engine.js';
import { AIInvestigator } from './ai/investigator.js';
import { assembleContext, AI_INTENTS } from './ai/context-assembler.js';
export class ObservabilityService {
    repository;
    correlation;
    investigator;
    engine;
    constructor(repository, correlation, investigator) {
        this.repository = repository;
        this.correlation = correlation;
        this.investigator = investigator;
        this.engine = new ExplorerQueryEngine(repository);
    }
    /** Resolve a resource by name, failing closed on unknown names. */
    resource(name) {
        const resource = explorerRegistry.get(name);
        if (!resource)
            throw new UnknownResourceError(name);
        return resource;
    }
    /** List of explorer resource names (for discovery/health). */
    resourceNames() {
        return explorerRegistry.names();
    }
    /** Toolbar facet metadata for a resource (available filters). */
    facets(name) {
        return buildFacets(this.resource(name));
    }
    async list(name, ctx, rawQuery) {
        const resource = this.resource(name);
        const query = buildExplorerQuery(rawQuery, resource.defaultSort);
        return this.engine.list(resource, ctx, query);
    }
    async summary(name, ctx, rawQuery) {
        const resource = this.resource(name);
        return this.engine.summary(resource, ctx, buildExplorerQuery(rawQuery, resource.defaultSort));
    }
    async statistics(name, ctx, rawQuery) {
        const resource = this.resource(name);
        return this.engine.statistics(resource, ctx, buildExplorerQuery(rawQuery, resource.defaultSort));
    }
    async timeline(name, ctx, rawQuery, interval) {
        const resource = this.resource(name);
        return this.engine.timeline(resource, ctx, buildExplorerQuery(rawQuery, resource.defaultSort), interval);
    }
    /**
     * Live tail: rows newer than `since` for the current filter set, ascending.
     * Backs the SSE stream — a bounded poll, no Redis pub/sub dependency.
     */
    async pollSince(name, ctx, rawQuery, since, max = 200) {
        const resource = this.resource(name);
        const base = buildExplorerQuery(rawQuery, resource.defaultSort);
        const query = {
            ...base,
            filters: [...base.filters, { field: 'timestamp', op: 'gt', value: since.toISOString() }],
            timeRange: { from: since, to: new Date(Date.now() + 60_000) },
            sort: { field: 'timestamp', direction: 'asc' },
            direction: 'forward',
            limit: max,
            live: true,
        };
        const result = await this.engine.list(resource, ctx, query);
        return result.items;
    }
    /** Universal event detail: one correlated payload; the frontend joins nothing. */
    async detail(name, ctx, id) {
        const resource = this.resource(name);
        const raw = await this.repository.fetchRawById(resource, ctx, id);
        if (!raw)
            throw new ExplorerNotFoundError(`${name} event`);
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
    async related(name, ctx, id, relation) {
        const resource = this.resource(name);
        const raw = await this.repository.fetchRawById(resource, ctx, id);
        if (!raw)
            throw new ExplorerNotFoundError(`${name} event`);
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
    async askEvent(name, ctx, id, intent, question) {
        const resource = this.resource(name);
        const raw = await this.repository.fetchRawById(resource, ctx, id);
        if (!raw)
            throw new ExplorerNotFoundError(`${name} event`);
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
    async askList(name, ctx, rawQuery, intent, question) {
        const resource = this.resource(name);
        const query = buildExplorerQuery(rawQuery, resource.defaultSort);
        const [listed, summary, statistics, timeline] = await Promise.all([
            this.engine.list(resource, ctx, { ...query, limit: 20 }),
            this.engine.summary(resource, ctx, query),
            this.engine.statistics(resource, ctx, query),
            this.engine.timeline(resource, ctx, query, 'hour'),
        ]);
        const seed = {
            resource: name,
            summary,
            statistics,
            sample: listed.items.slice(0, 10),
            timestamp: new Date().toISOString(),
        };
        const bundle = {
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
     * Detail timeline: occurrence trend for the event's natural group key over a
     * bounded window around the event. Errors group by fingerprint, requests by
     * route; other resources return an empty trend (their detail is point-in-time).
     */
    async detailTimeline(name, ctx, raw) {
        const filters = this.groupFilter(name, raw);
        if (filters.length === 0)
            return [];
        const resource = this.resource(name);
        const center = raw.timestamp instanceof Date ? raw.timestamp : new Date(String(raw.timestamp));
        const anchor = Number.isNaN(center.getTime()) ? new Date() : center;
        const query = {
            timeRange: { from: new Date(anchor.getTime() - 24 * 60 * 60 * 1000), to: new Date(anchor.getTime() + 60 * 60 * 1000) },
            filters,
            sort: resource.defaultSort,
            direction: 'forward',
            limit: 1,
            live: false,
        };
        return this.engine.timeline(resource, ctx, query, 'hour');
    }
    groupFilter(name, raw) {
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
    getNavigation() {
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
}
//# sourceMappingURL=service.js.map