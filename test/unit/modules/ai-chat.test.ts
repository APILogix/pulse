import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AIConfig } from '../../../src/config/ai.js';
import { MonitoringChatService, UNGROUNDED_CHAT_ANSWER } from '../../../src/modules/ai/chat.js';
import type { AIProvider } from '../../../src/modules/ai/openai-client.js';
import type { AIRepository } from '../../../src/modules/ai/repository.js';
import type { MonitoringTools } from '../../../src/modules/ai/monitoring-tools.js';

const requestId = '11111111-1111-4111-8111-111111111111';
const conversationId = '22222222-2222-4222-8222-222222222222';
const projectId = '33333333-3333-4333-8333-333333333333';

const config: AIConfig = {
  enabled: true, apiKey: 'test', primaryModel: 'primary', fallbackModel: 'fallback',
  embeddingModel: 'embedding', timeoutMs: 5_000, maxRetries: 0,
  circuitFailureThreshold: 2, circuitResetMs: 30_000, maxInputChars: 50_000,
  maxOutputTokens: 2_000, maxRetrievalChunks: 8, cacheTtlSeconds: 300,
  rateLimitPerMinute: 20, maxConcurrentJobsPerTenant: 5, maxConcurrentChatPerTenant: 10,
};

const logger = { warn: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
const identity = { tenantId: 'tenant-1', userId: 'user-1', idempotencyKey: 'chat-idem-1' };

function setup() {
  const repository = {
    authorizeMonitoringChat: vi.fn().mockResolvedValue({ role: 'admin', plan: 'enterprise', entitled: true, monthlyCredits: -1 }),
    getAccessibleProjects: vi.fn().mockResolvedValue([{ id: projectId, name: 'Payments', slug: 'payments', environment: 'production' }]),
    prepareChatRequest: vi.fn().mockResolvedValue({ requestId, conversationId, replay: null }),
    retrieveKnowledge: vi.fn().mockResolvedValue([]),
    recordChatToolCalls: vi.fn().mockResolvedValue(undefined),
    getChatHistory: vi.fn().mockResolvedValue([{ role: 'user', content: 'Why is payment failing?' }]),
    completeChatRequest: vi.fn().mockResolvedValue(undefined),
    failChatRequest: vi.fn().mockResolvedValue(undefined),
    confirmChatUsage: vi.fn().mockResolvedValue(true),
    recordGovernanceEvent: vi.fn().mockResolvedValue(undefined),
  };
  const provider = {
    available: true,
    embed: vi.fn().mockResolvedValue(null),
    complete: vi.fn(),
  };
  const tools = { execute: vi.fn().mockResolvedValue({ sources: [], calls: [] }) };
  const service = new MonitoringChatService(
    repository as unknown as AIRepository,
    provider as unknown as AIProvider,
    tools as unknown as MonitoringTools,
    config,
    logger,
  );
  return { service, repository, provider, tools };
}

beforeEach(() => vi.clearAllMocks());

describe('grounded organization monitoring chat', () => {
  it('returns the exact hard-rule response when organization data cannot ground the answer', async () => {
    const { service, provider, repository } = setup();

    const execution = await service.chat({ question: 'Why is payment service failing?', project_id: projectId }, identity);

    expect(execution.response.status).toBe('UNGROUNDED');
    expect(execution.response.answer).toBe(UNGROUNDED_CHAT_ANSWER);
    expect(execution.response.citations).toEqual([]);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(repository.failChatRequest).toHaveBeenCalledOnce();
  });

  it('refuses non-monitoring questions without calling tools or the model', async () => {
    const { service, provider, tools } = setup();

    const execution = await service.chat({ question: 'What is the weather today?' }, identity);

    expect(execution.response.answer).toBe(UNGROUNDED_CHAT_ANSWER);
    expect(tools.execute).not.toHaveBeenCalled();
    expect(provider.complete).not.toHaveBeenCalled();
  });

  it('synthesizes only cited organization sources and logs usage after delivery', async () => {
    const { service, provider, repository } = setup();
    repository.retrieveKnowledge.mockResolvedValue([{
      sourceId: 'doc-1', sourceType: 'runbook', title: 'Payment runbook', reference: 'kb://doc-1',
      content: 'Connection pool saturation causes payment timeouts.', accessLevel: 'admin', version: 1, score: 0.9,
    }]);
    provider.complete.mockResolvedValue({
      content: JSON.stringify({
        answer: 'The payment failures match connection pool saturation [1].',
        source_ids: ['doc-1'], suggested_next_steps: ['Inspect pool utilization.'],
      }),
      provider: 'openai', model: 'primary', promptTokens: 20, completionTokens: 10,
      latencyMs: 50, fallbackUsed: false,
    });

    const execution = await service.chat({ question: 'Why is payment service failing?', project_id: projectId }, identity);

    expect(execution.response.status).toBe('SUCCESS');
    expect(execution.response.citations[0]).toMatchObject({ source_id: 'doc-1', marker: '[1]' });
    expect(repository.completeChatRequest).toHaveBeenCalledOnce();
    expect(execution.usagePending).toBe(true);
    await service.confirmUsage({ tenantId: identity.tenantId }, execution);
    expect(repository.confirmChatUsage).toHaveBeenCalledWith(identity.tenantId, requestId);
  });

  it('rejects model output that lacks an inline citation to an allowlisted source', async () => {
    const { service, provider, repository } = setup();
    repository.retrieveKnowledge.mockResolvedValue([{
      sourceId: 'doc-1', sourceType: 'runbook', title: 'Payment runbook', reference: 'kb://doc-1',
      content: 'Connection pool saturation causes payment timeouts.', accessLevel: 'admin', version: 1, score: 0.9,
    }]);
    provider.complete.mockResolvedValue({
      content: JSON.stringify({ answer: 'The pool is exhausted.', source_ids: ['doc-1'], suggested_next_steps: [] }),
      provider: 'openai', model: 'primary', promptTokens: 10, completionTokens: 5,
      latencyMs: 20, fallbackUsed: false,
    });

    const execution = await service.chat({ question: 'Why is payment service failing?' }, identity);

    expect(execution.response.status).toBe('UNGROUNDED');
    expect(execution.response.answer).toBe(UNGROUNDED_CHAT_ANSWER);
    expect(repository.completeChatRequest).not.toHaveBeenCalled();
  });
});
