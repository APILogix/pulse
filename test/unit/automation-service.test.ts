/**
 * Unit tests for AutomationService.
 * Tests: creation validation/limit/risk, publish immutability, manual run+steps,
 * disabled/lost entitlement, duplicate event/run, approval approve/reject, audit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationService } from '../../src/modules/automation/service.js';

// ── Mock repository ───────────────────────────────────────────────────────────
function createMockRepo() {
  return {
    getMemberRole: vi.fn().mockResolvedValue('admin'),
    hasEntitlement: vi.fn().mockResolvedValue(true),
    getWorkflowLimit: vi.fn().mockResolvedValue(-1),
    countOrgWorkflows: vi.fn().mockResolvedValue(5),
    batchCheckEntitlements: vi.fn().mockImplementation((_orgId: string, keys: string[]) => {
      const map = new Map<string, boolean>();
      for (const k of keys) map.set(k, true);
      return Promise.resolve(map);
    }),
    verifyProjectOwnership: vi.fn().mockResolvedValue(true),
    listWorkflows: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getWorkflow: vi.fn().mockResolvedValue(null),
    getWorkflowFullDefinition: vi.fn().mockResolvedValue(null),
    getWorkflowForUpdate: vi.fn().mockResolvedValue(null),
    getActiveVersion: vi.fn().mockResolvedValue(null),
    getVersionActions: vi.fn().mockResolvedValue([]),
    getVersionConditions: vi.fn().mockResolvedValue([]),
    createWorkflowTransaction: vi.fn().mockResolvedValue({ id: 'wf-1', name: 'Test', slug: 'test', status: 'draft' }),
    updateWorkflowDraft: vi.fn().mockResolvedValue({ id: 'wf-1' }),
    softDeleteWorkflow: vi.fn().mockResolvedValue(true),
    setWorkflowEnabled: vi.fn().mockResolvedValue({ id: 'wf-1', isEnabled: true }),
    publishWorkflowVersion: vi.fn().mockResolvedValue({ id: 'v-1', version: 2, checksum: 'abc123' }),
    createRunWithSteps: vi.fn().mockResolvedValue({ run: { id: 'run-1', status: 'queued' }, steps: [{ id: 'step-1' }] }),
    insertInboxEvent: vi.fn().mockResolvedValue({ event: { id: 'evt-1', status: 'pending', dedupeKey: 'dk-1', attempts: 0 }, created: true }),
    listRuns: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getRun: vi.fn().mockResolvedValue(null),
    listRunSteps: vi.fn().mockResolvedValue([]),
    cancelRun: vi.fn().mockResolvedValue(null),
    retryRun: vi.fn().mockResolvedValue(null),
    listApprovals: vi.fn().mockResolvedValue({ data: [], total: 0 }),
    getApproval: vi.fn().mockResolvedValue(null),
    approveApproval: vi.fn().mockResolvedValue({ id: 'appr-1', status: 'approved', workflowId: 'wf-1', runId: 'run-1' }),
    rejectApproval: vi.fn().mockResolvedValue({ id: 'appr-1', status: 'rejected', workflowId: 'wf-1', runId: 'run-1' }),
    insertAuditLog: vi.fn().mockResolvedValue(undefined),
    listAuditLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as any;
}

function createMockAudit() {
  return {
    insertAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    listAuditLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  } as any;
}

function createMockRunner() {
  return { execute: vi.fn(), getHandler: vi.fn(), getRegisteredTypes: vi.fn() } as any;
}

const META = { actorUserId: 'user-1', actorIp: '127.0.0.1', actorUserAgent: 'test', requestId: 'req-1' };
const ORG = 'org-1';
const USER = 'user-1';

describe('AutomationService', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let audit: ReturnType<typeof createMockAudit>;
  let service: AutomationService;

  beforeEach(() => {
    repo = createMockRepo();
    audit = createMockAudit();
    service = new AutomationService(repo, audit, createMockRunner());
  });

  // ── Role checks ──────────────────────────────────────────────────
  describe('requireRole', () => {
    it('throws for non-member', async () => {
      repo.getMemberRole.mockResolvedValue(null);
      await expect(service.requireRole(ORG, USER, 'member')).rejects.toThrow('Not a member');
    });

    it('throws if role insufficient', async () => {
      repo.getMemberRole.mockResolvedValue('member');
      await expect(service.requireRole(ORG, USER, 'admin')).rejects.toThrow('Requires admin');
    });

    it('passes with sufficient role', async () => {
      repo.getMemberRole.mockResolvedValue('owner');
      await expect(service.requireRole(ORG, USER, 'admin')).resolves.toBe('owner');
    });
  });

  // ── Create workflow validation ───────────────────────────────────
  describe('createWorkflow', () => {
    const validInput = {
      name: 'My Workflow', workflowType: 'alert_routing' as const, scope: 'organization' as const,
      trigger: { triggerKind: 'event', triggerType: 'alert.event.created', sourceModule: 'alerting', sourceEvent: 'alert.event.created', timezone: 'UTC', config: {} },
      conditions: [], actions: [{ actionKey: 'notify', actionType: 'notification.send', riskLevel: 'low', config: {} }],
      tags: [], metadata: {},
    };

    it('rejects platform scope via public API', async () => {
      await expect(service.createWorkflow(ORG, USER, { ...validInput, scope: 'platform' }, META))
        .rejects.toThrow('Platform scope is not allowed');
    });

    it('rejects project scope without projectId', async () => {
      await expect(service.createWorkflow(ORG, USER, { ...validInput, scope: 'project' }, META))
        .rejects.toThrow('Project scope requires projectId');
    });

    it('rejects if project does not belong to org', async () => {
      repo.verifyProjectOwnership.mockResolvedValue(false);
      await expect(service.createWorkflow(ORG, USER, { ...validInput, scope: 'project', projectId: 'p-1' }, META))
        .rejects.toThrow('Project does not belong');
    });

    it('rejects if automation not enabled', async () => {
      repo.hasEntitlement.mockResolvedValue(false);
      await expect(service.createWorkflow(ORG, USER, validInput, META))
        .rejects.toThrow('module_automation_enabled');
    });

    it('rejects if workflow limit exceeded', async () => {
      repo.getWorkflowLimit.mockResolvedValue(5);
      repo.countOrgWorkflows.mockResolvedValue(5);
      await expect(service.createWorkflow(ORG, USER, validInput, META))
        .rejects.toThrow('Limit exceeded');
    });

    it('rejects high-risk action without approval', async () => {
      const input = {
        ...validInput,
        actions: [{ actionKey: 'pause', actionType: 'release.guard.pause', riskLevel: 'high', requiresApproval: false, config: {} }],
      };
      await expect(service.createWorkflow(ORG, USER, input, META))
        .rejects.toThrow('must require approval');
    });

    it('rejects dangerous action without approval', async () => {
      const input = {
        ...validInput,
        actions: [{ actionKey: 'purge', actionType: 'retention.purge_request', riskLevel: 'medium', requiresApproval: false, config: {} }],
      };
      await expect(service.createWorkflow(ORG, USER, input, META))
        .rejects.toThrow('Dangerous action');
    });

    it('creates workflow successfully with valid input', async () => {
      const result = await service.createWorkflow(ORG, USER, validInput, META);
      expect(result).toHaveProperty('id', 'wf-1');
      expect(repo.createWorkflowTransaction).toHaveBeenCalledTimes(1);
    });
  });

  // ── Publish immutability ─────────────────────────────────────────
  describe('publishWorkflow', () => {
    it('throws if workflow not found', async () => {
      repo.getWorkflowFullDefinition.mockResolvedValue(null);
      await expect(service.publishWorkflow(ORG, USER, 'wf-1', false, META))
        .rejects.toThrow('not found');
    });

    it('throws if checksum unchanged (immutability)', async () => {
      const triggers = [{ triggerKind: 'event', triggerType: 'alert.event.created' }];
      const actions = [{ actionKey: 'a', actionType: 'noop' }];
      const def = { workflow: { id: 'wf-1' }, triggers, conditions: [], actions, activeVersion: { checksum: '' } };
      repo.getWorkflowFullDefinition.mockResolvedValue(def);
      // Make checksum match
      const checksum = service.computeChecksum({ trigger: triggers[0], conditions: [], actions });
      def.activeVersion.checksum = checksum;
      await expect(service.publishWorkflow(ORG, USER, 'wf-1', false, META))
        .rejects.toThrow('No changes to publish');
    });

    it('publishes successfully when checksum differs', async () => {
      const def = {
        workflow: { id: 'wf-1' }, triggers: [{ triggerKind: 'event' }],
        conditions: [], actions: [{ actionKey: 'a', actionType: 'noop' }],
        activeVersion: { checksum: 'old-checksum' },
      };
      repo.getWorkflowFullDefinition.mockResolvedValue(def);
      const result = await service.publishWorkflow(ORG, USER, 'wf-1', false, META);
      expect(result).toHaveProperty('version', 2);
    });
  });

  // ── Manual run + steps ───────────────────────────────────────────
  describe('manualRun', () => {
    it('throws if workflow disabled', async () => {
      repo.getWorkflowFullDefinition.mockResolvedValue({
        workflow: { id: 'wf-1', isEnabled: false, projectId: null },
        triggers: [], conditions: [], actions: [], activeVersion: { id: 'v-1' },
      });
      await expect(service.manualRun(ORG, USER, 'wf-1', {}, META))
        .rejects.toThrow('disabled');
    });

    it('throws if no published version', async () => {
      repo.getWorkflowFullDefinition.mockResolvedValue({
        workflow: { id: 'wf-1', isEnabled: true, projectId: null },
        triggers: [], conditions: [], actions: [], activeVersion: null,
      });
      repo.getActiveVersion.mockResolvedValue(null);
      await expect(service.manualRun(ORG, USER, 'wf-1', {}, META))
        .rejects.toThrow('no published version');
    });

    it('creates run and steps for valid workflow', async () => {
      repo.getWorkflowFullDefinition.mockResolvedValue({
        workflow: { id: 'wf-1', isEnabled: true, projectId: null },
        triggers: [], conditions: [],
        actions: [{ id: 'act-1', actionKey: 'notify', actionType: 'notification.send', isEnabled: true, maxAttempts: 3, requiresApproval: false }],
        activeVersion: { id: 'v-1' },
      });
      // getVersionActions returns the pinned version actions
      repo.getVersionActions.mockResolvedValue([
        { id: 'act-1', actionKey: 'notify', actionType: 'notification.send', isEnabled: true, maxAttempts: 3, requiresApproval: false },
      ]);
      const result = await service.manualRun(ORG, USER, 'wf-1', { test: true }, META);
      expect(result.run).toHaveProperty('id', 'run-1');
      expect(repo.createRunWithSteps).toHaveBeenCalledTimes(1);
      // Always audits run.queued
      expect(repo.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'run.queued' }));
    });
  });

  // ── Disabled workflow ────────────────────────────────────────────
  describe('disabled/entitlement', () => {
    it('blocks run when automation entitlement missing', async () => {
      repo.hasEntitlement.mockResolvedValue(false);
      await expect(service.manualRun(ORG, USER, 'wf-1', {}, META))
        .rejects.toThrow('module_automation_enabled');
    });
  });

  // ── Duplicate event/run ──────────────────────────────────────────
  describe('ingestEvent', () => {
    it('returns duplicate flag for already-processed event', async () => {
      repo.insertInboxEvent.mockResolvedValue({ event: { id: 'evt-1', status: 'processed', dedupeKey: 'dk-1' }, created: false });
      const result = await service.ingestEvent(ORG, USER, {
        sourceModule: 'alerting', eventType: 'alert.event.created' as any,
        dedupeKey: 'dk-1', payload: {},
      }, META);
      expect(result.duplicate).toBe(true);
    });

    it('rejects oversized payload', async () => {
      const bigPayload: Record<string, unknown> = { data: 'x'.repeat(300000) };
      await expect(service.ingestEvent(ORG, USER, {
        sourceModule: 'alerting', eventType: 'alert.event.created' as any,
        dedupeKey: 'dk-big', payload: bigPayload,
      }, META)).rejects.toThrow('Payload too large');
    });

    it('accepts valid event and returns not duplicate', async () => {
      const result = await service.ingestEvent(ORG, USER, {
        sourceModule: 'alerting', eventType: 'alert.event.created' as any,
        dedupeKey: 'dk-new', payload: { severity: 'critical' },
      }, META);
      expect(result.duplicate).toBe(false);
      expect(result.created).toBe(true);
    });
  });

  // ── Approvals ────────────────────────────────────────────────────
  describe('approvals', () => {
    it('approve writes audit log', async () => {
      const result = await service.approveApproval(ORG, USER, 'appr-1', 'Looks good', META);
      expect(result.status).toBe('approved');
      expect(repo.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'approval.approved' }));
    });

    it('reject writes audit log', async () => {
      const result = await service.rejectApproval(ORG, USER, 'appr-1', 'Too risky', META);
      expect(result.status).toBe('rejected');
      expect(repo.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'approval.rejected' }));
    });
  });

  // ── Cancel/retry ─────────────────────────────────────────────────
  describe('cancelRun', () => {
    it('throws if run not found', async () => {
      repo.cancelRun.mockResolvedValue(null);
      await expect(service.cancelRun(ORG, USER, 'run-x', META)).rejects.toThrow('not found');
    });
  });

  describe('retryRun', () => {
    it('throws if run not in retryable status', async () => {
      repo.getRun.mockResolvedValue({ id: 'run-1', status: 'running', attempt: 1, maxAttempts: 3 });
      await expect(service.retryRun(ORG, USER, 'run-1', META)).rejects.toThrow('not retryable');
    });

    it('throws if max attempts reached', async () => {
      repo.getRun.mockResolvedValue({ id: 'run-1', status: 'failed', attempt: 3, maxAttempts: 3 });
      await expect(service.retryRun(ORG, USER, 'run-1', META)).rejects.toThrow('Max attempts');
    });
  });

  // ── Timezone validation ──────────────────────────────────────────
  describe('validateTimezone', () => {
    it('accepts valid IANA timezones', () => {
      expect(service.validateTimezone('UTC')).toBe(true);
      expect(service.validateTimezone('America/New_York')).toBe(true);
    });

    it('rejects invalid timezone', () => {
      expect(service.validateTimezone('Not/A/Timezone')).toBe(false);
    });
  });

  // ── Slug generation ──────────────────────────────────────────────
  describe('generateSlug', () => {
    it('converts name to URL-safe slug', () => {
      expect(service.generateSlug('My Workflow Name!')).toBe('my-workflow-name');
    });
  });

  // ── Audit access ─────────────────────────────────────────────────
  describe('listAudit', () => {
    it('requires admin role', async () => {
      repo.getMemberRole.mockResolvedValue('member');
      await expect(service.listAudit(ORG, USER, { limit: 50, offset: 0 })).rejects.toThrow('Requires admin');
    });
  });
});
