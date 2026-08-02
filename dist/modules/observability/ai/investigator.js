import { aiConfig } from '../../../config/ai.js';
import { buildPrompts } from './context-assembler.js';
export class AIInvestigator {
    provider;
    logger;
    constructor(provider, logger) {
        this.provider = provider;
        this.logger = logger;
    }
    async investigate(context, intent, question) {
        if (aiConfig.enabled && this.provider && this.provider.available) {
            try {
                const { system, user } = buildPrompts(context, intent, question);
                const route = {
                    primaryModel: aiConfig.primaryModel,
                    fallbackModel: aiConfig.fallbackModel,
                    temperature: 0.2,
                    maxTokens: aiConfig.maxOutputTokens,
                    timeoutMs: aiConfig.timeoutMs,
                };
                const completion = await this.provider.complete(system, user, route, 'AI_MONITORING_CHAT');
                const parsed = this.parse(completion.content);
                return { intent, ...parsed, source: 'ai', model: completion.model };
            }
            catch (err) {
                this.logger.warn({ err, intent }, 'AI investigation failed; falling back to heuristic analysis');
            }
        }
        return this.heuristic(context, intent, question);
    }
    parse(content) {
        try {
            const obj = JSON.parse(content);
            const findings = Array.isArray(obj.findings)
                ? obj.findings.filter((x) => typeof x === 'string')
                : [];
            const recommendations = Array.isArray(obj.recommendations)
                ? obj.recommendations.filter((x) => typeof x === 'string')
                : [];
            return {
                summary: typeof obj.summary === 'string' ? obj.summary : '',
                findings,
                rootCause: typeof obj.rootCause === 'string' ? obj.rootCause : null,
                recommendations,
                confidence: typeof obj.confidence === 'number' ? obj.confidence : 0.5,
            };
        }
        catch {
            return { summary: content.slice(0, 2000), findings: [], rootCause: null, recommendations: [], confidence: 0.3 };
        }
    }
    /** Deterministic analysis when no model is available. Uses the fact set. */
    heuristic(context, intent, question) {
        const findings = [...context.facts];
        const recommendations = [];
        let rootCause = null;
        const c = context.counts;
        const seed = context.seed;
        const errorCount = c.errors ?? 0;
        if (errorCount > 0) {
            rootCause = `${errorCount} correlated error(s) in the surrounding window are the most likely contributor.`;
            recommendations.push('Open the correlated errors and inspect their stack traces and fingerprints.');
        }
        switch (intent) {
            case 'performance': {
                const latency = Number(seed.latency_ms ?? seed.duration_ms ?? seed.total_duration_ms ?? 0);
                if (latency >= 1000) {
                    findings.push(`High latency observed (${latency}ms).`);
                    recommendations.push('Review the slowest spans and any database/external calls on the critical path.');
                    if (!rootCause)
                        rootCause = 'Latency is dominated by one or more slow downstream spans.';
                }
                else {
                    findings.push('Latency is within normal bounds for this event.');
                }
                break;
            }
            case 'security': {
                const status = Number(seed.status_code ?? seed.http_status_code ?? 0);
                if (status === 401 || status === 403) {
                    findings.push(`Authorization-related status code ${status} detected.`);
                    recommendations.push('Check authentication/authorization logs for the correlated user/session.');
                }
                else {
                    findings.push('No obvious authentication/authorization anomaly in the event fields.');
                }
                break;
            }
            case 'optimization': {
                recommendations.push('Add or tighten indexes for hot query paths surfaced in correlated spans.');
                recommendations.push('Cache repeated external calls and batch N+1 database access.');
                break;
            }
            case 'incident_summary': {
                recommendations.push('Assign an owner, link correlated errors, and set a monitor if recurrence is likely.');
                break;
            }
            case 'find_similar': {
                const sig = seed.fingerprint ?? seed.error_name ?? seed.route ?? seed.name ?? seed.metric_name;
                findings.push(`Signature for similarity search: ${String(sig ?? 'n/a')}.`);
                break;
            }
            case 'ask': {
                if (question)
                    findings.unshift(`Question: ${question}`);
                break;
            }
            case 'explain':
            case 'root_cause':
            default:
                break;
        }
        const summary = `Deterministic ${intent.replace('_', ' ')} analysis for ${context.resource}. ${context.facts[0] ?? ''}`.trim();
        return {
            intent,
            summary,
            findings,
            rootCause,
            recommendations,
            confidence: 0.4,
            source: 'heuristic',
            model: null,
        };
    }
}
//# sourceMappingURL=investigator.js.map