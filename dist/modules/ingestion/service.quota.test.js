import { describe, expect, it, vi } from 'vitest';
import { IngestionService } from './service.js';
function createRequestEvent() {
    return {
        type: 'request',
        requestId: '11111111-1111-1111-1111-111111111111',
        url: '/health',
        method: 'GET',
        statusCode: 200,
        latency: 12,
        timestamp: Date.now(),
        headers: {},
        query: {},
        bodySize: 0,
        userId: null
    };
}
describe('ingestion quota enforcement', () => {
    it('throws QUOTA_EXCEEDED with structured details when blocked', async () => {
        const queue = { addBulk: vi.fn().mockResolvedValue(undefined), client: Promise.resolve({ ping: vi.fn() }) };
        const cache = {
            getProjectByApiKeyHash: vi.fn().mockResolvedValue({
                id: 'project-1',
                orgId: 'org-1',
                name: 'Project',
                environment: 'production',
                rateLimitPerSecond: 1000,
                rateLimitPerMinute: 10000,
                allowedEventTypes: ['request', 'error', 'log', 'metric', 'custom'],
                isActive: true,
                apiKeyId: 'key-1'
            }),
            checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9999, resetAt: Date.now() + 60000 }),
            isCircuitOpen: vi.fn().mockResolvedValue(false),
            checkIdempotency: vi.fn().mockResolvedValue(true),
            incrementIngestCounter: vi.fn().mockResolvedValue(undefined),
            recordLastIngest: vi.fn().mockResolvedValue(undefined)
        };
        const writer = { getProjectByApiKeyHash: vi.fn() };
        const quotaService = {
            checkIngestionQuota: vi.fn().mockResolvedValue({
                success: true,
                data: {
                    allowed: false,
                    current: 1000,
                    limit: 1000,
                    remaining: 0,
                    subscriptionStatus: 'past_due',
                    reason: 'grace_period_expired'
                }
            })
        };
        const service = new IngestionService(queue, cache, writer, quotaService, {
            maxBatchSize: 1000,
            defaultRateLimitPerSecond: 1000,
            defaultRateLimitPerMinute: 10000
        });
        await expect(service.ingestBatch({ apiKey: 'test-api-key', events: [createRequestEvent()] })).rejects.toMatchObject({
            message: 'QUOTA_EXCEEDED',
            details: {
                orgId: 'org-1',
                requested: 1,
                current: 1000,
                limit: 1000,
                remaining: 0,
                subscriptionStatus: 'past_due',
                reason: 'grace_period_expired'
            }
        });
        await service.shutdown();
    });
    it('accepts events when quota allows ingestion', async () => {
        const queue = { addBulk: vi.fn().mockResolvedValue(undefined), client: Promise.resolve({ ping: vi.fn() }) };
        const cache = {
            getProjectByApiKeyHash: vi.fn().mockResolvedValue({
                id: 'project-1',
                orgId: 'org-1',
                name: 'Project',
                environment: 'production',
                rateLimitPerSecond: 1000,
                rateLimitPerMinute: 10000,
                allowedEventTypes: ['request', 'error', 'log', 'metric', 'custom'],
                isActive: true,
                apiKeyId: 'key-1'
            }),
            checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9999, resetAt: Date.now() + 60000 }),
            isCircuitOpen: vi.fn().mockResolvedValue(false),
            checkIdempotency: vi.fn().mockResolvedValue(true),
            incrementIngestCounter: vi.fn().mockResolvedValue(undefined),
            recordLastIngest: vi.fn().mockResolvedValue(undefined)
        };
        const writer = { getProjectByApiKeyHash: vi.fn() };
        const quotaService = {
            checkIngestionQuota: vi.fn().mockResolvedValue({
                success: true,
                data: {
                    allowed: true,
                    current: 10,
                    limit: 1000,
                    remaining: 989,
                    subscriptionStatus: 'trialing'
                }
            })
        };
        const service = new IngestionService(queue, cache, writer, quotaService, {
            maxBatchSize: 1000,
            defaultRateLimitPerSecond: 1000,
            defaultRateLimitPerMinute: 10000
        });
        const result = await service.ingestBatch({ apiKey: 'test-api-key', events: [createRequestEvent()] });
        expect(result.success).toBe(true);
        expect(result.accepted).toBe(1);
        expect(result.rejected).toBe(0);
        await service.shutdown();
    });
});
//# sourceMappingURL=service.quota.test.js.map