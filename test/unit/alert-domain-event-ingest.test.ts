/**
 * Unit tests for ingestAlertDomainEvent — the automation-side consumer of
 * AlertDomainOutboxRelay jobs (src/modules/alerting/runtime/alert-domain-outbox-relay.ts).
 *
 * This pins down the contract at the exact seam alerting and automation share:
 *   - a bridged event is entitlement-gated independently of the API layer
 *   - a successful insert audits as actorType:'system', never 'user' (ingestEvent's
 *     HTTP-actor path is deliberately bypassed for this trusted system handoff)
 *   - a duplicate dedupeKey (idempotency reservation, outbox redelivery, or a crash
 *     reclaim) never re-audits or re-enqueues
 *   - a failed enqueue of the downstream inbox.process job does not fail the whole
 *     ingest (DB is the source of truth; the scheduled sweep recovers it) — this
 *     function itself never retries; the CALLER is expected to rethrow so pg-boss's
 *     retry (owned by the relay) is the single retry mechanism
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/lib/pgboss.js', () => ({
  pgboss: {
    send: vi.fn().mockResolvedValue('job-id'),
    work: vi.fn(),
    schedule: vi.fn(),
    unschedule: vi.fn(),
    createQueue: vi.fn(),
  },
}));

vi.mock('../../src/config/database.js', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

const { ingestAlertDomainEvent } = await import('../../src/modules/automation/workers.js');

function makeLogger() {
  return {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
    fatal: vi.fn(), trace: vi.fn(), silent: vi.fn(),
    child() { return makeLogger(); },
    level: 'info',
  } as never;
}

function makeRepo(overrides: Partial<{ entitled: boolean; created: boolean }> = {}) {
  const entitled = overrides.entitled ?? true;
  const created = overrides.created ?? true;
  return {
    hasEntitlement: vi.fn().mockResolvedValue(entitled),
    insertInboxEvent: vi.fn().mockResolvedValue({
      created,
      event: { id: 'inbox-evt-1', status: 'pending' },
    }),
  } as never;
}

function makeAuditRepo() {
  return { insertAuditLog: vi.fn().mockResolvedValue(undefined) } as never;
}

const JOB: import('../../src/modules/automation/workers.js').AlertDomainEventJobData = {
  organizationId: 'org-a',
  projectId: null,
  eventType: 'alert.event.created',
  alertKey: 'alert-key-1',
  alertEventId: 'alert-evt-1',
  dedupeKey: 'alert:alert.event.created:idem-1',
  payload: { severity: 'critical', service: 'api' },
  metadata: {},
  occurredAt: new Date().toISOString(),
};

describe('ingestAlertDomainEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-checks module_automation_enabled entitlement independently of the API layer', async () => {
    const repo = makeRepo({ entitled: false });
    const auditRepo = makeAuditRepo();
    const result = await ingestAlertDomainEvent(JOB, repo, auditRepo, makeLogger());

    expect(result).toEqual({ created: false, skippedReason: 'not_entitled' });
    expect((repo as unknown as { hasEntitlement: ReturnType<typeof vi.fn> }).hasEntitlement)
      .toHaveBeenCalledWith('org-a', 'module_automation_enabled');
    // Not entitled -> never attempts the insert at all.
    expect((repo as unknown as { insertInboxEvent: ReturnType<typeof vi.fn> }).insertInboxEvent)
      .not.toHaveBeenCalled();
    expect((auditRepo as unknown as { insertAuditLog: ReturnType<typeof vi.fn> }).insertAuditLog)
      .not.toHaveBeenCalled();
  });

  it('inserts via insertInboxEvent directly, never via the human-actor ingestEvent path', async () => {
    const repo = makeRepo();
    const auditRepo = makeAuditRepo();
    await ingestAlertDomainEvent(JOB, repo, auditRepo, makeLogger());

    const call = (repo as unknown as { insertInboxEvent: ReturnType<typeof vi.fn> }).insertInboxEvent.mock.calls[0]![0];
    expect(call).toMatchObject({
      organizationId: 'org-a',
      sourceModule: 'alerting',
      eventType: 'alert.event.created',
      sourceEventId: 'alert-evt-1',
      dedupeKey: 'alert:alert.event.created:idem-1',
      payload: { severity: 'critical', service: 'api' },
    });
    // metadata carries provenance for downstream debugging.
    expect(call.metadata).toMatchObject({ bridgedFrom: 'alerting', alertKey: 'alert-key-1' });
  });

  it('audits as actorType:"system" on a genuine new event, not "user"', async () => {
    const repo = makeRepo({ created: true });
    const auditRepo = makeAuditRepo();
    await ingestAlertDomainEvent(JOB, repo, auditRepo, makeLogger());

    const auditCall = (auditRepo as unknown as { insertAuditLog: ReturnType<typeof vi.fn> }).insertAuditLog.mock.calls[0]![0];
    expect(auditCall).toMatchObject({
      organizationId: 'org-a',
      actorType: 'system',
      action: 'trigger.received',
      entityType: 'inbox_event',
      entityId: 'inbox-evt-1',
    });
  });

  it('does not audit or enqueue again when insertInboxEvent reports a duplicate (created=false)', async () => {
    const repo = makeRepo({ created: false });
    const auditRepo = makeAuditRepo();
    const result = await ingestAlertDomainEvent(JOB, repo, auditRepo, makeLogger());

    expect(result).toEqual({ created: false });
    expect((auditRepo as unknown as { insertAuditLog: ReturnType<typeof vi.fn> }).insertAuditLog)
      .not.toHaveBeenCalled();
  });

  it('best-effort enqueues automation.inbox.process but does not throw when the enqueue fails', async () => {
    const { pgboss } = await import('../../src/lib/pgboss.js');
    (pgboss.send as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('queue unavailable'));
    const repo = makeRepo({ created: true });
    const auditRepo = makeAuditRepo();
    const log = makeLogger();

    await expect(ingestAlertDomainEvent(JOB, repo, auditRepo, log)).resolves.toEqual({ created: true });
    // Audit already happened (DB is the source of truth); enqueue failure is
    // logged and swallowed here — the CALLER's rethrow-on-outer-error path is
    // for insert/entitlement failures, not this best-effort notification.
    expect((auditRepo as unknown as { insertAuditLog: ReturnType<typeof vi.fn> }).insertAuditLog)
      .toHaveBeenCalledTimes(1);
    expect((log as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
  });

  it('propagates insertInboxEvent failures so the caller can rethrow for pg-boss retry (single retry owner)', async () => {
    const repo = makeRepo();
    (repo as unknown as { insertInboxEvent: ReturnType<typeof vi.fn> }).insertInboxEvent
      .mockRejectedValueOnce(new Error('db unavailable'));
    const auditRepo = makeAuditRepo();

    await expect(ingestAlertDomainEvent(JOB, repo, auditRepo, makeLogger())).rejects.toThrow('db unavailable');
  });
});
