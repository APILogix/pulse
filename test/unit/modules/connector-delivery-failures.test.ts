import { describe, it, expect, vi, beforeAll } from 'vitest';

let NotificationDispatcher: typeof import('../../../src/modules/connectors/delivery/delivery.service.js').NotificationDispatcher;

beforeAll(async () => {
  process.env.NODE_ENV = 'development';
  ({ NotificationDispatcher } = await import('../../../src/modules/connectors/delivery/delivery.service.js'));
});

describe('Connector Delivery Failures', () => {
  it('BUG-10: should transition to dead letter on non-retryable errors', async () => {
    const repository = {
      insertDeadLetter: vi.fn().mockResolvedValue(undefined),
      markDeliveryFailed: vi.fn().mockResolvedValue(undefined),
      insertAuditLog: vi.fn().mockResolvedValue(undefined),
      recordFailure: vi.fn().mockResolvedValue(undefined),
    };
    const logger = { child: vi.fn().mockReturnThis(), error: vi.fn(), warn: vi.fn(), info: vi.fn() };
    const emitEvent = vi.fn();

    const dispatcher = new NotificationDispatcher(repository as any, logger as any, emitEvent);
    
    vi.spyOn(dispatcher, 'instantiate').mockResolvedValue({
      send: vi.fn().mockResolvedValue({
        success: false,
        errorMessage: 'Invalid configuration',
        failureCategory: 'invalid_config',
        retryable: false,
        latencyMs: 10
      }),
    } as any);

    const result = await (dispatcher as any).attemptDelivery(
      { id: 'connector-1', max_retries: 3, failure_threshold: 5, organization_id: 'org-1' },
      { id: 'delivery-1', attempts: 0 },
      { notificationType: 'alert', severity: 'high', correlationId: '123' },
      0
    );

    expect(result.status).toBe('failed');
    expect(result.result.retryable).toBe(false);
    expect(repository.markDeliveryFailed).toHaveBeenCalled();
    expect(repository.insertDeadLetter).toHaveBeenCalled();
    expect(emitEvent).toHaveBeenCalledWith('connector.dead_letter', expect.any(Object));
  });
});
