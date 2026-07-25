import { randomUUID } from 'crypto';
import { sanitizeUntrusted, stableStringify } from './security.js';
function boundedResult(value) {
    return sanitizeUntrusted(value, 20_000).value;
}
export class MonitoringTools {
    analytics;
    alerting;
    eventAnalytics;
    constructor(analytics, alerting, eventAnalytics) {
        this.analytics = analytics;
        this.alerting = alerting;
        this.eventAnalytics = eventAnalytics;
    }
    async execute(input) {
        const sources = [];
        const calls = [];
        const question = input.question.toLowerCase();
        const selectedProject = input.requestedProjectId
            ? input.projects.find((project) => project.id === input.requestedProjectId)
            : input.projects.length === 1 ? input.projects[0] : undefined;
        if (!selectedProject && /project|service|monitor(?:ed|ing)/i.test(question)) {
            this.addResult(sources, calls, 'list_monitored_projects', null, {}, {
                monitoredProjects: input.projects.map(({ id, name, slug, environment }) => ({ id, name, slug, environment })),
                note: 'The current monitoring store exposes projects; it does not expose a standalone service catalog.',
            }, 0, 'Monitored projects');
        }
        const metricIntent = /latency|throughput|request|error rate|p50|p95|p99|metric/i.test(question);
        if (metricIntent) {
            const projectId = input.requestedProjectId;
            const query = {
                range: '24h',
                from: input.from,
                to: input.to,
                ...(projectId ? { projectId } : {}),
            };
            await this.capture(sources, calls, 'query_metrics', projectId ?? null, { from: input.from.toISOString(), to: input.to.toISOString(), expression: input.timeExpression }, async () => {
                const metrics = await this.eventAnalytics.getOverview(input.tenantId, query);
                const requests = metrics.requests;
                const durationMinutes = Math.max(1, (input.to.getTime() - input.from.getTime()) / 60_000);
                return {
                    timeRangeExpression: input.timeExpression,
                    errorRatePercent: Number(((requests?.errorRate ?? 0) * 100).toFixed(4)),
                    throughputPerMinute: Number(((requests?.total ?? 0) / durationMinutes).toFixed(4)),
                    metrics,
                };
            }, projectId && selectedProject
                ? `Live request metrics for ${selectedProject.name}`
                : 'Live organization request metrics');
            if (/trend|over time|time series|daily|hourly|weekly/i.test(question)) {
                const durationMs = input.to.getTime() - input.from.getTime();
                const granularity = durationMs <= 48 * 60 * 60 * 1_000 ? 'hour'
                    : durationMs <= 60 * 24 * 60 * 60 * 1_000 ? 'day' : 'week';
                await this.capture(sources, calls, 'query_metric_trends', projectId ?? null, { from: input.from.toISOString(), to: input.to.toISOString(), granularity }, () => this.eventAnalytics.getTrends(input.tenantId, { ...query, granularity }), 'Live request metric trends');
            }
        }
        if (selectedProject) {
            const range = { from: input.from, to: input.to };
            if (/endpoint|route|api|slow|performance|fail|error|exception|dashboard|overview/i.test(question)) {
                await this.capture(sources, calls, 'get_endpoint_performance', selectedProject.id, { from: input.from.toISOString(), to: input.to.toISOString() }, () => this.analytics.getDashboard(selectedProject.id, range), `Endpoint and error dashboard for ${selectedProject.name}`);
            }
        }
        if (/alert|firing|alarm|page|incident/i.test(question)) {
            await this.capture(sources, calls, 'list_alerts', null, { limit: 20, offset: 0, sortOrder: 'desc' }, () => this.alerting.listEvents(input.tenantId, { limit: 20, offset: 0, sortOrder: 'desc' }), 'Recent organization alert events');
        }
        return { sources: sources.slice(0, 5), calls: calls.slice(0, 5) };
    }
    async capture(sources, calls, toolName, projectId, args, work, title) {
        const started = Date.now();
        try {
            const result = boundedResult(await this.withTimeout(work(), 5_000));
            this.addResult(sources, calls, toolName, projectId, args, result, Date.now() - started, title);
        }
        catch (error) {
            calls.push({
                invocationId: randomUUID(), toolName, projectId, arguments: args,
                result: { error: 'Monitoring data query failed' }, durationMs: Date.now() - started, status: 'failed',
            });
            // A failed tool is audited but is never supplied as grounding evidence.
            void error;
        }
    }
    async withTimeout(promise, timeoutMs) {
        let timer;
        try {
            return await Promise.race([
                promise,
                new Promise((_resolve, reject) => {
                    timer = setTimeout(() => reject(new Error('Monitoring tool timed out')), timeoutMs);
                }),
            ]);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    addResult(sources, calls, toolName, projectId, args, result, durationMs, title) {
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
//# sourceMappingURL=monitoring-tools.js.map