import { ExplorerQueryEngine, ExplorerNotFoundError, UnknownResourceError, buildExplorerQuery, buildFacets, projectPublicRow, } from './query-engine/index.js';
import { explorerRegistry } from './resources/index.js';
import { ObservabilityRepository } from './repository.js';
import { CorrelationEngine } from './correlation/engine.js';
import { AIInvestigator } from './ai/investigator.js';
import { assembleContext, AI_INTENTS } from './ai/context-assembler.js';
import { LifecycleConflictError } from '../errors/services/issue-lifecycle.service.js';
export class ObservabilityService {
    repository;
    correlation;
    investigator;
    lifecycle;
    engine;
    constructor(repository, correlation, investigator, lifecycle) {
        this.repository = repository;
        this.correlation = correlation;
        this.investigator = investigator;
        this.lifecycle = lifecycle;
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
    async detail(name, ctx, id) {
        const resource = this.resource(name);
        const raw = await this.repository.fetchRawById(resource, ctx, id);
        if (!raw)
            throw new ExplorerNotFoundError(`${name} event`);
        const bundle = await this.correlation.correlate(name, ctx, raw);
        const timeline = await this.detailTimeline(name, ctx, raw);
        const facts = assembleContext(name, raw, bundle, timeline).facts;
        const entity = projectPublicRow(resource, resource.mapRow(raw));
        if (bundle.trace && !entity.tracePublicId) {
            const tracePubId = (bundle.trace.publicId ?? bundle.trace.public_id);
            if (tracePubId) {
                entity.tracePublicId = tracePubId;
            }
        }
        return {
            resource: name,
            entity,
            attributes: null,
            metadata: null,
            payload: null,
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
     * Bulk AI investigation for a selected array of row IDs or filtered result set.
     */
    async analyzeBulk(name, ctx, body) {
        const resource = this.resource(name);
        let sample = [];
        let summary = {};
        let statistics = {};
        const isSelectedMode = body.selectionMode === 'selected' && body.selectedIds && body.selectedIds.length > 0 && !body.selectAll;
        if (isSelectedMode && body.selectedIds && body.selectedIds.length <= 100) {
            sample = await this.repository.fetchRawByIds(resource, ctx, body.selectedIds);
            summary = { selectedCount: sample.length };
        }
        else {
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
        const seed = {
            resource: name,
            selectionMode: body.selectionMode ?? (isSelectedMode ? 'selected' : 'filtered'),
            selectedCount: body.selectedIds?.length ?? 0,
            summary,
            statistics,
            sample: sample.slice(0, 20),
            userPrompt: promptText,
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
        const context = assembleContext(name, seed, bundle, []);
        context.facts.push(`Selection Mode: ${body.selectionMode ?? 'filtered'}`);
        if (body.prompt)
            context.facts.push(`User Question: ${body.prompt}`);
        context.facts.push(`Analyzed ${sample.length} records: ${JSON.stringify(sample.slice(0, 10))}`);
        return this.investigator.investigate(context, body.intent ?? 'explain', promptText);
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
        const rawTime = raw.occurred_at ?? raw.timestamp;
        const center = rawTime instanceof Date ? rawTime : new Date(String(rawTime));
        const anchor = Number.isNaN(center.getTime()) ? new Date() : center;
        const query = {
            timeRange: { from: new Date(anchor.getTime() - 24 * 60 * 60 * 1000), to: new Date(anchor.getTime() + 60 * 60 * 1000) },
            filters,
            sort: resource.defaultSort,
            direction: 'forward',
            limit: 1,
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
    /**
     * Rich detail for an Error Group including latest stack frames and trends (24h, 7d, 30d).
     */
    async getErrorGroupFullDetail(ctx, groupId) {
        const resource = this.resource('error-groups');
        const raw = await this.repository.fetchRawById(resource, ctx, groupId);
        if (!raw)
            throw new ExplorerNotFoundError('Error Group');
        const mapped = projectPublicRow(resource, resource.mapRow(raw));
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
    async getErrorGroupHistory(ctx, groupId) {
        return this.repository.getErrorGroupHistory(ctx, groupId);
    }
    /** Fetch related telemetry error events for an error group. */
    async getErrorGroupEvents(ctx, groupId, limit = 50) {
        const resource = this.resource('error-groups');
        const raw = await this.repository.fetchRawById(resource, ctx, groupId);
        const fingerprint = raw ? String(raw.fingerprint ?? '') : undefined;
        return this.repository.getRelatedErrorEvents(ctx, groupId, fingerprint, limit);
    }
    /** Update error group status through the canonical lifecycle service. */
    async updateErrorGroupStatus(ctx, groupId, status, comment, expectedVersion, release) {
        if (!this.lifecycle)
            throw new Error('ERROR_GROUP_LIFECYCLE_UNAVAILABLE');
        const projectId = await this.resolveGroupProject(ctx, groupId);
        const normalized = status.toUpperCase();
        const options = {
            ...(ctx.userId ? { actorId: ctx.userId } : {}),
            ...(comment ? { reason: comment } : {}),
            ...(expectedVersion !== undefined ? { expectedVersion } : {}),
            ...(release !== undefined ? { release } : {}),
        };
        if (normalized === 'RESOLVED')
            await this.lifecycle.resolve(projectId, groupId, options);
        else if (normalized === 'IGNORED')
            await this.lifecycle.ignore(projectId, groupId, options);
        else if (normalized === 'ARCHIVED')
            await this.lifecycle.archive(projectId, groupId, options);
        else if (normalized === 'OPEN')
            await this.lifecycle.reopen(projectId, groupId, options);
        else
            throw new Error(`INVALID_ERROR_GROUP_STATUS:${status}`);
        return this.getErrorGroupFullDetail(ctx, groupId);
    }
    /** Merge source error group into target group through the canonical lifecycle service. */
    async mergeErrorGroup(ctx, sourceGroupId, targetGroupId, reason, expectedVersion) {
        if (!this.lifecycle)
            throw new Error('ERROR_GROUP_LIFECYCLE_UNAVAILABLE');
        const projectId = await this.resolveGroupProject(ctx, sourceGroupId);
        await this.lifecycle.merge(projectId, sourceGroupId, targetGroupId, {
            ...(ctx.userId ? { actorId: ctx.userId } : {}),
            ...(reason ? { reason } : {}),
            ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        });
        return this.getErrorGroupFullDetail(ctx, targetGroupId);
    }
    async unmergeErrorGroup(ctx, groupId, reason, expectedVersion) {
        if (!this.lifecycle)
            throw new Error('ERROR_GROUP_LIFECYCLE_UNAVAILABLE');
        const projectId = await this.resolveGroupProject(ctx, groupId);
        await this.lifecycle.unmerge(projectId, groupId, {
            ...(ctx.userId ? { actorId: ctx.userId } : {}),
            ...(reason ? { reason } : {}),
            ...(expectedVersion !== undefined ? { expectedVersion } : {}),
        });
        return this.getErrorGroupFullDetail(ctx, groupId);
    }
    async resolveGroupProject(ctx, groupId) {
        const raw = await this.repository.fetchRawById(this.resource('error-groups'), ctx, groupId);
        if (!raw)
            throw new ExplorerNotFoundError('Error Group');
        const projectId = String(raw.project_id ?? '');
        if (!projectId || (ctx.allowedProjectIds && !ctx.allowedProjectIds.includes(projectId))) {
            throw new ExplorerNotFoundError('Error Group');
        }
        return projectId;
    }
}
//# sourceMappingURL=service.js.map