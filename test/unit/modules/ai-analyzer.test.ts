import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/config/database.js', () => ({ pool: {} }));

import type { AIConfig } from '../../../src/config/ai.js';
import { AIAnalyzer } from '../../../src/modules/ai/analyzer.js';
import { OpenAIProvider, type AIProvider } from '../../../src/modules/ai/openai-client.js';
import { AIRepository, AIRepositoryError, type CreditReservation } from '../../../src/modules/ai/repository.js';
import { sha256 } from '../../../src/modules/ai/security.js';
import { DEFAULT_CREDIT_COSTS, type AIAnswer, type AIRequestInput } from '../../../src/modules/ai/types.js';

const config: AIConfig = {
  enabled: true,
  apiKey: 'test-key',
  primaryModel: 'primary-model',
  fallbackModel: 'fallback-model',
  embeddingModel: 'embedding-model',
  timeoutMs: 5_000,
  maxRetries: 0,
  circuitFailureThreshold: 1,
  circuitResetMs: 30_000,
  maxInputChars: 50_000,
  maxOutputTokens: 2_000,
  maxRetrievalChunks: 8,
  cacheTtlSeconds: 300,
  rateLimitPerMinute: 20,
  maxConcurrentJobsPerTenant: 5,
  maxConcurrentChatPerTenant: 10,
};

const logger = {
  warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), fatal: vi.fn(), trace: vi.fn(), child: vi.fn(),
} as unknown as FastifyBaseLogger;

const input: AIRequestInput = {
  ai_mode: 'AI_ERROR_EXPLANATION',
  user_query: 'Explain this timeout',
};

function answer(confidence = 85): AIAnswer {
  return {
    status: 'SUCCESS', ai_mode: input.ai_mode, request_id: 'provider-request',
    plain_language_summary: 'The dependency timed out.', business_impact: 'Requests may be delayed.',
    technical_analysis: 'The supplied telemetry shows a dependency timeout.', likely_causes: [], evidence: [],
    confidence_score: confidence, suggested_fixes: ['Use a bounded retry.'],
    verification_steps: ['Confirm dependency latency.'], prevention_recommendations: ['Alert on dependency latency.'],
    missing_data: [], citations: [], safety_warnings: [],
    credit_action: {
      billable: false, amount: 0, reason: 'Provider recommendation only', mode: input.ai_mode,
      status: 'SUCCESS', idempotency_key: 'idem-12345', cached: false, refunded: false,
      requires_backend_confirmation: true,
    },
    metadata: {},
  };
}
function reservation(amount = 2): CreditReservation {
  return {
    tenantId: 'tenant-1', requestId: 'request-1', idempotencyKey: 'idem-12345',
    mode: input.ai_mode, amount, unlimited: false,
  };
}

function setup(options: { cachedCost?: number; partialCost?: number; chargePartial?: boolean } = {}) {
  const repo = {
    authorize: vi.fn().mockResolvedValue({ role: 'admin', plan: 'enterprise', entitled: true, monthlyCredits: 100 }),
    resolveCreditRules: vi.fn().mockResolvedValue({
      costs: DEFAULT_CREDIT_COSTS,
      cachedCost: options.cachedCost ?? 0,
      partialCost: options.partialCost ?? 0,
      chargePartial: options.chargePartial ?? false,
    }),
    getKnowledgeVersion: vi.fn().mockResolvedValue('knowledge-v1'),
    getExistingAnswer: vi.fn().mockResolvedValue(null),
    getCached: vi.fn().mockResolvedValue(null),
    prepareRequest: vi.fn().mockResolvedValue({ reservation: reservation(), duplicateResponse: null }),
    resolveModelRoute: vi.fn().mockImplementation((_tenant, _plan, _mode, defaults) => Promise.resolve(defaults)),
    retrieveKnowledge: vi.fn().mockResolvedValue([]),
    adjustReservation: vi.fn().mockImplementation((item, amount) => Promise.resolve({ ...item, amount })),
    releaseReservation: vi.fn().mockResolvedValue(undefined),
    finalizeReservation: vi.fn().mockResolvedValue(undefined),
    recordSuccessfulUsage: vi.fn().mockResolvedValue(undefined),
    persistAnswer: vi.fn().mockResolvedValue('response-1'),
    markRequestFailed: vi.fn().mockResolvedValue(undefined),
    recordGovernanceEvent: vi.fn().mockResolvedValue(undefined),
  };
  const provider = {
    available: true,
    embed: vi.fn().mockResolvedValue(null),
    complete: vi.fn().mockResolvedValue({
      content: JSON.stringify(answer()), provider: 'openai', model: 'fallback-model',
      promptTokens: 10, completionTokens: 20, latencyMs: 30, fallbackUsed: true,
    }),
  };
  const analyzer = new AIAnalyzer(
    repo as unknown as AIRepository,
    provider as unknown as AIProvider,
    config,
    logger,
  );
  return { analyzer, repo, provider };
}

const identity = {
  tenantId: 'tenant-1', userId: 'user-1', requestId: 'request-1', idempotencyKey: 'idem-12345',
};

beforeEach(() => vi.clearAllMocks());

describe('AIAnalyzer enterprise billing and delivery gates', () => {
  it('persists a successful fallback answer and bills only after delivery confirmation', async () => {
    const { analyzer, repo } = setup();
    repo.retrieveKnowledge.mockResolvedValue([{
      sourceId: 'doc-1', sourceType: 'runbook', title: 'Trusted runbook', reference: 'kb://doc-1',
      content: 'Verify dependency latency.', accessLevel: 'admin', version: 2, score: 0.9,
    }]);
    const providerAnswer = answer();
    providerAnswer.citations = [{
      source_type: 'fake', source_id: 'doc-1', title: 'Fake title', url_or_reference: 'https://fake.invalid',
      access_level: 'public', why_cited: 'It contains the verification procedure.',
    }];
    const provider = (analyzer as unknown as { provider: { complete: ReturnType<typeof vi.fn> } }).provider;
    provider.complete.mockResolvedValue({
      content: JSON.stringify(providerAnswer), provider: 'openai', model: 'fallback-model',
      promptTokens: 10, completionTokens: 20, latencyMs: 30, fallbackUsed: true,
    });

    const execution = await analyzer.analyze(input, identity);

    expect(execution.answer.status).toBe('SUCCESS');
    expect(execution.answer.metadata.fallback_used).toBe(true);
    expect(execution.answer.citations[0]).toMatchObject({
      title: 'Trusted runbook', url_or_reference: 'kb://doc-1', access_level: 'admin',
    });
    expect(repo.finalizeReservation).not.toHaveBeenCalled();
    await analyzer.confirmDelivery(execution);
    expect(repo.finalizeReservation).toHaveBeenCalledOnce();
  });

  it('releases the reservation for a useful answer below the confidence threshold', async () => {
    const { analyzer, repo, provider } = setup();
    provider.complete.mockResolvedValue({
      content: JSON.stringify(answer(50)), provider: 'openai', model: 'primary-model',
      promptTokens: 1, completionTokens: 1, latencyMs: 5, fallbackUsed: false,
    });

    const execution = await analyzer.analyze(input, identity);

    expect(execution.answer.status).toBe('PARTIAL');
    expect(execution.answer.credit_action.billable).toBe(false);
    expect(execution.reservation).toBeNull();
    expect(repo.releaseReservation).toHaveBeenCalledOnce();
  });

  it('returns an exact idempotent replay without invoking the provider or charging again', async () => {
    const { analyzer, repo, provider } = setup();
    const original = answer();
    original.request_id = 'original-request';
    repo.getExistingAnswer.mockResolvedValue({
      answer: original, responseId: 'response-original', inputHash: sha256(input), mode: input.ai_mode,
    });

    const execution = await analyzer.analyze(input, identity);

    expect(execution.responseId).toBe('response-original');
    expect(execution.answer.request_id).toBe('original-request');
    expect(execution.answer.credit_action.amount).toBe(0);
    expect(execution.answer.metadata.idempotent_replay).toBe(true);
    expect(provider.complete).not.toHaveBeenCalled();
    expect(repo.prepareRequest).not.toHaveBeenCalled();
  });

  it('rejects reuse of an idempotency key for different sanitized input', async () => {
    const { analyzer, repo } = setup();
    repo.getExistingAnswer.mockResolvedValue({
      answer: answer(), responseId: 'response-original', inputHash: sha256({ different: true }), mode: input.ai_mode,
    });

    await expect(analyzer.analyze(input, identity)).rejects.toMatchObject<Partial<AIRepositoryError>>({
      code: 'IDEMPOTENCY_CONFLICT',
    });
  });

  it('applies free and paid cached-answer policies without a provider call', async () => {
    const free = setup();
    free.repo.getCached.mockResolvedValue(answer());
    const freeExecution = await free.analyzer.analyze(input, identity);
    expect(freeExecution.answer.credit_action.amount).toBe(0);
    expect(free.repo.prepareRequest).not.toHaveBeenCalled();
    expect(free.provider.complete).not.toHaveBeenCalled();
    await free.analyzer.confirmDelivery(freeExecution);
    expect(free.repo.recordSuccessfulUsage).toHaveBeenCalledOnce();

    const paid = setup({ cachedCost: 1 });
    paid.repo.getCached.mockResolvedValue(answer());
    paid.repo.prepareRequest.mockResolvedValue({ reservation: reservation(1), duplicateResponse: null });
    const paidExecution = await paid.analyzer.analyze(input, identity);
    expect(paidExecution.answer.credit_action.amount).toBe(1);
    expect(paidExecution.reservation?.amount).toBe(1);
    expect(paid.provider.complete).not.toHaveBeenCalled();
    await paid.analyzer.confirmDelivery(paidExecution);
    expect(paid.repo.finalizeReservation).toHaveBeenCalledOnce();
  });

  it('releases reserved credits when provider output violates the exact contract', async () => {
    const { analyzer, repo, provider } = setup();
    provider.complete.mockResolvedValue({
      content: JSON.stringify({ status: 'SUCCESS', unexpected: true }), provider: 'openai', model: 'primary-model',
      promptTokens: 1, completionTokens: 1, latencyMs: 5, fallbackUsed: false,
    });

    const execution = await analyzer.analyze(input, identity);

    expect(execution.answer.status).toBe('PROVIDER_ERROR');
    expect(execution.answer.credit_action.amount).toBe(0);
    expect(repo.releaseReservation).toHaveBeenCalledOnce();
    expect(repo.markRequestFailed).toHaveBeenCalledOnce();
  });
});

describe('OpenAIProvider fallback resilience', () => {
  it('allows the configured in-flight fallback after the primary opens the circuit', async () => {
    const provider = new OpenAIProvider(config, logger);
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('primary unavailable'))
      .mockResolvedValueOnce({
        model: 'fallback-model',
        choices: [{ message: { content: JSON.stringify(answer()) } }],
        usage: { prompt_tokens: 3, completion_tokens: 4 },
      });
    const internal = provider as unknown as {
      client: { chat: { completions: { create: typeof create } } };
    };
    internal.client.chat.completions.create = create;

    const completion = await provider.complete('system', 'user', {
      primaryModel: 'primary-model', fallbackModel: 'fallback-model', temperature: 0.2,
      maxTokens: 1_000, timeoutMs: 5_000,
    }, input.ai_mode);

    expect(create).toHaveBeenCalledTimes(2);
    expect(completion.model).toBe('fallback-model');
    expect(completion.fallbackUsed).toBe(true);
  });
});


describe('AIRepository refund boundary', () => {
  it('validates the amount, invokes the idempotent database refund, and writes governance audit', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('ai_refund_credit')) return { rows: [{ refunded: true }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query, release: vi.fn() };
    const database = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const repository = new AIRepository(database);

    await expect(repository.refundCredits({
      tenantId: 'tenant-1', actorUserId: 'admin-1', requestId: 'request-1',
      idempotencyKey: 'refund-1', mode: input.ai_mode, amount: 2, reason: 'Answer retracted',
    })).resolves.toBe(true);

    expect(query.mock.calls.some(([sql]) => String(sql).includes('ai_refund_credit'))).toBe(true);
    expect(query.mock.calls.some(([sql]) => String(sql).includes('ai.credit_refunded'))).toBe(true);
    await expect(repository.refundCredits({
      tenantId: 'tenant-1', actorUserId: 'admin-1', requestId: 'request-1',
      idempotencyKey: 'refund-2', mode: input.ai_mode, amount: 0.5, reason: 'Invalid amount',
    })).rejects.toThrow('positive safe integer');
  });
});
