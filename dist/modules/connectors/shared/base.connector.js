import { ConnectorDeliveryError } from '../types.js';
export class BaseConnector {
    id;
    name;
    ctx;
    constructor(ctx) {
        this.ctx = ctx;
        this.id = ctx.id;
        this.name = ctx.name;
    }
    validateConfig(config) {
        const parsed = this.configSchema.safeParse(config);
        if (parsed.success) {
            return { valid: true, errors: [], normalized: parsed.data };
        }
        return {
            valid: false,
            errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
        };
    }
    async send(notification) {
        const start = Date.now();
        try {
            const result = await this.deliver(notification);
            return { ...result, latencyMs: result.latencyMs || Date.now() - start };
        }
        catch (err) {
            if (err instanceof ConnectorDeliveryError) {
                return {
                    success: false,
                    errorMessage: err.message,
                    failureCategory: err.failureCategory,
                    retryable: err.retryable,
                    latencyMs: Date.now() - start,
                };
            }
            // Unknown errors are treated as non-retryable to avoid hammering a
            // provider with a request that deterministically blows up.
            return {
                success: false,
                errorMessage: err instanceof Error ? err.message : 'Unknown delivery error',
                failureCategory: 'unknown',
                retryable: false,
                latencyMs: Date.now() - start,
            };
        }
    }
    async getHealthStatus() {
        const test = await this.testConnection();
        return {
            state: test.success ? 'healthy' : 'unhealthy',
            responseTimeMs: test.latencyMs,
            message: test.message,
            checkedAt: new Date().toISOString(),
            ...(test.details ? { details: test.details } : {}),
        };
    }
    getRateLimitInfo() {
        return this.ctx.rateLimit;
    }
    /** Typed view of the injected config, validated lazily by callers. */
    config() {
        return this.ctx.config;
    }
}
//# sourceMappingURL=base.connector.js.map