import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIRepository, AIRepositoryError } from '../../src/modules/ai/repository.js';
import { entitlementsService } from '../../src/modules/billing/entitlements/service.js';

describe('AI Credit Concurrency & Idempotency Hardening', () => {
  const tenantId = 'org-ai-test-123';
  const userId = 'user-ai-1';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('atomically reserves AI credits within row-locked transaction', async () => {
    let currentBalance = 100;
    let currentReserved = 0;

    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO ai_requests')) {
          return { rowCount: 1, rows: [{ request_id: params?.[0] }] };
        }
        if (sql.includes('INSERT INTO credit_balances')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT balance, reserved_credits, unlimited FROM credit_balances')) {
          return { rows: [{ balance: String(currentBalance), reserved_credits: String(currentReserved), unlimited: false }] };
        }
        if (sql.includes('UPDATE credit_balances SET reserved_credits = reserved_credits + $2')) {
          const cost = Number(params?.[1] ?? 0);
          currentReserved += cost;
          return { rowCount: 1 };
        }
        if (sql.includes('INSERT INTO credit_ledger')) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    const aiRepo = new AIRepository();
    vi.spyOn(aiRepo as any, 'transaction').mockImplementation(async (cb: any) => cb(mockClient));

    const result = await aiRepo.prepareRequest({
      tenantId,
      userId,
      requestId: 'req-1',
      idempotencyKey: 'idemp-1',
      mode: 'incident_copilot',
      inputHash: 'hash-1',
      cacheKey: 'cache-1',
      cost: 40,
      monthlyCredits: 100,
    });

    expect(result.reservation).toBeDefined();
    expect(result.reservation?.amount).toBe(40);
    expect(currentReserved).toBe(40);
  });

  it('rejects credit reservation when requested cost exceeds available balance', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO ai_requests')) {
          return { rowCount: 1, rows: [{ request_id: params?.[0] }] };
        }
        if (sql.includes('INSERT INTO credit_balances')) {
          return { rows: [] };
        }
        if (sql.includes('SELECT balance, reserved_credits, unlimited FROM credit_balances')) {
          return { rows: [{ balance: '100', reserved_credits: '80', unlimited: false }] }; // available: 20
        }
        if (sql.includes('UPDATE ai_requests SET status = \'INSUFFICIENT_CREDITS\'')) {
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    const aiRepo = new AIRepository();
    vi.spyOn(aiRepo as any, 'transaction').mockImplementation(async (cb: any) => cb(mockClient));

    await expect(
      aiRepo.prepareRequest({
        tenantId,
        userId,
        requestId: 'req-2',
        idempotencyKey: 'idemp-2',
        mode: 'incident_copilot',
        inputHash: 'hash-2',
        cacheKey: 'cache-2',
        cost: 40, // 40 > 20 available
        monthlyCredits: 100,
      })
    ).rejects.toThrow(AIRepositoryError);
  });

  it('returns existing cached answer without recharging on idempotent retries', async () => {
    const mockClient = {
      query: vi.fn().mockImplementation(async (sql: string, params?: unknown[]) => {
        if (sql.includes('INSERT INTO ai_requests')) {
          return { rowCount: 0 }; // duplicate idempotency conflict
        }
        if (sql.includes('SELECT r.answer, r.response_id, q.input_hash, q.ai_mode FROM ai_requests q')) {
          return {
            rows: [{
              answer: { text: 'Resolved incident report', confidence: 0.95 },
              response_id: 'resp-prev-123',
              input_hash: 'hash-idemp',
              ai_mode: 'incident_copilot',
            }],
          };
        }
        return { rows: [] };
      }),
    };

    const aiRepo = new AIRepository();
    vi.spyOn(aiRepo as any, 'transaction').mockImplementation(async (cb: any) => cb(mockClient));

    const result = await aiRepo.prepareRequest({
      tenantId,
      userId,
      requestId: 'req-retry',
      idempotencyKey: 'idemp-prev',
      mode: 'incident_copilot',
      inputHash: 'hash-idemp',
      cacheKey: 'cache-idemp',
      cost: 50,
      monthlyCredits: 100,
    });

    expect(result.reservation).toBeNull();
    expect(result.duplicateResponse).toBeDefined();
    expect(result.duplicateResponse?.responseId).toBe('resp-prev-123');
  });
});
