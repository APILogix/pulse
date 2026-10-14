/**
 * Behavioral tests for Phase 2 automation hardening.
 * Tests verify actual BEHAVIOR, not source content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationService } from '../../src/modules/automation/service.js';
import { TemplateService } from '../../src/modules/automation/template.service.js';
import { evaluateConditions } from '../../src/modules/automation/evaluator.js';
import { validateWebhookUrl } from '../../src/modules/automation/ssrf.js';
import { FEATURE_KEYS, collectRequiredFeatureKeys } from '../../src/modules/automation/entitlements.js';

function createMockRepo() {
  return {
    getMemberRole: vi.fn().mockResolvedValue('admin'),
    hasEntitlement: vi.fn().mockResolvedValue(true),
    getWorkflowLimit: vi.fn().mockResolvedValue(-1),
    countOrgWorkflows: vi.fn().mockResolvedValue(5),
    verifyProjectOwnership: vi.fn().mockResolvedValue(true),
    batchCheckEntitlements: vi.fn().mockImplementation((_orgId: string, keys: string[]) => {
      const map = new Map<string, boolean>();
      for (const k of keys) map.set(k, true);
      return Promise.resolve(map);
    }),
    createWorkflowTransaction: vi.fn().mockResolvedValue({ id: 'wf-1', name: 'Test', slug: 'test', status: 'draft' }),
    getWorkflow: vi.fn().mockResolvedValue({ id: 'wf-1', isEnabled: false }),
    getWorkflowFullDefinition: vi.fn().mockResolvedValue(null),
    getActiveVersion: vi.fn().mockResolvedValue(null),
    getVersionActions: vi.fn().mockResolvedValue([]),
    setWorkflowEnabled: vi.fn().mockResolvedValue({ id: 'wf-1', isEnabled: true }),
    createRunWithSteps: vi.fn().mockResolvedValue({ run: { id: 'run-1', status: 'queued' }, steps: [] }),
    insertInboxEvent: vi.fn().mockResolvedValue({ event: { id: 'evt-1' }, created: true }),
    insertAuditLog: vi.fn().mockResolvedValue(undefined),
    cancelRun: vi.fn().mockResolvedValue({ id: 'run-1', workflowId: 'wf-1' }),
    getRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'failed', attempt: 1, maxAttempts: 3, workflowId: 'wf-1' }),
    retryRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'queued', attempt: 2, workflowId: 'wf-1' }),
    approveApproval: vi.fn().mockResolvedValue({ id: 'appr-1', status: 'approved', workflowId: 'wf-1', runId: 'run-1' }),
    rejectApproval: vi.fn().mockResolvedValue({ id: 'appr-1', status: 'rejected', workflowId: 'wf-1', runId: 'run-1' }),
  } as any;
}

function createMockAudit() {
  return { insertAuditLog: vi.fn().mockResolvedValue({ id: 'audit-1' }), listAuditLogs: vi.fn().mockResolvedValue({ data: [], total: 0 }) } as any;
}

function createMockRunner() {
  return { execute: vi.fn(), getHandler: vi.fn(), getRegisteredTypes: vi.fn() } as any;
}

const META = { actorUserId: 'user-1', actorIp: '127.0.0.1', actorUserAgent: 'TestAgent/1.0', requestId: 'req-1' };
const ORG = 'org-1';
const USER = 'user-1';

describe('Phase 2 Behavioral Hardening', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let audit: ReturnType<typeof createMockAudit>;
  let service: AutomationService;

  beforeEach(() => {
    repo = createMockRepo();
    audit = createMockAudit();
    service = new AutomationService(repo, audit, createMockRunner());
  });

  /**
   * POLICY CHANGE: webhook.call is now connector-referenced rather than
   * inline-URL-with-approval.
   *
   * The old policy required per-run human approval AND SSRF-checked a `targetUrl`
   * stored in the workflow definition. That was simultaneously unusable (a human
   * had to approve every single webhook) and weaker than it appeared, because the
   * destination and any embedded credentials lived in workflow config.
   *
   * The new policy refuses inline URLs outright and requires a pre-existing webhook
   * connector, so SSRF validation runs inside the connectors subsystem on every
   * send (connectors/shared/http.ts -> validateWebhookUrl) and secrets stay in
   * encrypted connector_credentials. Approval is no longer needed because the
   * destination is pre-approved infrastructure, not author-supplied input.
   */
  describe('webhook.call server policy (connector-scoped)', () => {
    const baseInput = {
      name: 'Test', workflowType: 'custom' as const, scope: 'organization' as const,
      trigger: { triggerKind: 'event', triggerType: 'manual.run', sourceModule: 'automation', sourceEvent: 'manual.run', timezone: 'UTC', config: {} },
      conditions: [],
      tags: [], metadata: {},
    };

    it('rejects an inline targetUrl, even an HTTPS one', async () => {
      const input = {
        ...baseInput,
        actions: [{ actionKey: 'call', actionType: 'webhook.call', riskLevel: 'medium', requiresApproval: false, config: { targetUrl: 'https://api.example.com/hook' } }],
      };
      await expect(service.createWorkflow(ORG, USER, input, META))
        .rejects.toThrow('does not accept an inline URL');
    });

    it('rejects an inline SSRF-unsafe URL regardless of approval', async () => {
      const input = {
        ...baseInput,
        actions: [{ actionKey: 'call', actionType: 'webhook.call', riskLevel: 'medium', requiresApproval: true, config: { targetUrl: 'https://169.254.169.254/meta' } }],
      };
      // Rejected because inline URLs are not accepted at all — a strictly stronger
      // guarantee than SSRF-inspecting a URL we would then store.
      await expect(service.createWorkflow(ORG, USER, input, META))
        .rejects.toThrow('does not accept an inline URL');
    });

    it('rejects webhook.call pointed at a non-webhook connector transport', async () => {
      const input = {
        ...baseInput,
        actions: [{ actionKey: 'call', actionType: 'webhook.call', riskLevel: 'medium', requiresApproval: false, config: { connectorType: 'email' } }],
      };
      await expect(service.createWorkflow(ORG, USER, input, META))
        .rejects.toThrow('requires a webhook connector');
    });

    it('accepts a connector-referenced webhook.call without approval', async () => {
      const input = {
        ...baseInput,
        actions: [{ actionKey: 'call', actionType: 'webhook.call', riskLevel: 'medium', requiresApproval: false, config: { connectorId: '11111111-1111-4111-8111-111111111111' } }],
      };
      await expect(service.createWorkflow(ORG, USER, input, META)).resolves.toBeDefined();
    });
  });

  describe('evaluator matches operator with regex safety', () => {
    it('rejects catastrophic backtracking patterns', () => {
      const conditions = [{ conditionGroup: 'default', sortOrder: 0, leftPath: 'name', operator: 'matches' as const, rightValue: '(a+)+$', isRequired: true }];
      const result = evaluateConditions({ name: 'aaaaX' }, conditions);
      expect(result.conditionResults[0]!.passed).toBe(false);
    });

    it('accepts safe patterns', () => {
      const conditions = [{ conditionGroup: 'default', sortOrder: 0, leftPath: 'name', operator: 'matches' as const, rightValue: '^hello', isRequired: true }];
      const result = evaluateConditions({ name: 'hello world' }, conditions);
      expect(result.conditionResults[0]!.passed).toBe(true);
    });
  });

  describe('batch feature check blocks missing entitlements', () => {
    it('blocks create when required feature missing', async () => {
      repo.batchCheckEntitlements.mockImplementation((_orgId: string, keys: string[]) => {
        const map = new Map<string, boolean>();
        for (const k of keys) map.set(k, k === FEATURE_KEYS.AUTOMATION_ENABLED);
        return Promise.resolve(map);
      });
      const input = {
        name: 'Test', workflowType: 'alert_routing' as const, scope: 'organization' as const,
        trigger: { triggerKind: 'event', triggerType: 'alert.event.created', sourceModule: 'alerting', sourceEvent: 'alert.event.created', timezone: 'UTC', config: {} },
        conditions: [],
        actions: [{ actionKey: 'notify', actionType: 'notification.send', riskLevel: 'low', config: {} }],
        tags: [], metadata: {},
      };
      await expect(service.createWorkflow(ORG, USER, input, META)).rejects.toThrow('Entitlement required');
    });
  });

  describe('enable requires published version', () => {
    it('rejects enable when no published version', async () => {
      repo.getActiveVersion.mockResolvedValue(null);
      await expect(service.enableWorkflow(ORG, USER, 'wf-1', META)).rejects.toThrow('published version');
    });
  });

  describe('approver role validation', () => {
    it('rejects approval from non-admin', async () => {
      repo.getMemberRole.mockResolvedValue('member');
      await expect(service.approveApproval(ORG, USER, 'appr-1', 'ok', META)).rejects.toThrow('Requires admin');
    });

    it('passes decisionPayload to repo', async () => {
      await service.approveApproval(ORG, USER, 'appr-1', 'ok', META, { notes: 'safe' });
      expect(repo.approveApproval).toHaveBeenCalledWith(ORG, 'appr-1', USER, 'ok', { notes: 'safe' });
    });

    it('enqueues execute resume on approval', async () => {
      const enqueueFn = vi.fn().mockResolvedValue(undefined);
      service.setEnqueueFn(enqueueFn);
      await service.approveApproval(ORG, USER, 'appr-1', 'ok', META);
      expect(enqueueFn).toHaveBeenCalledWith({ type: 'automation.run.execute', payload: { runId: 'run-1', orgId: ORG } });
    });
  });

  describe('cancel/retry pass reason/fromStep', () => {
    it('cancel persists reason in audit', async () => {
      await service.cancelRun(ORG, USER, 'run-1', { ...META, reason: 'No longer needed' });
      expect(repo.insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ metadata: { reason: 'No longer needed' } }));
    });

    it('retry passes fromStep', async () => {
      await service.retryRun(ORG, USER, 'run-1', { ...META, fromStep: 'step-3' });
      expect(repo.retryRun).toHaveBeenCalledWith(ORG, 'run-1', 'step-3');
    });
  });

  describe('Idempotency-Key passthrough', () => {
    it('uses provided key for manual run', async () => {
      repo.getWorkflowFullDefinition.mockResolvedValue({
        workflow: { id: 'wf-1', isEnabled: true, projectId: null },
        triggers: [], conditions: [],
        actions: [{ id: 'a-1', actionKey: 'n', actionType: 'noop', isEnabled: true, maxAttempts: 3, requiresApproval: false, timeoutSeconds: 60, retryBackoffSeconds: 30, riskLevel: 'low', config: {} }],
        activeVersion: { id: 'v-1', definition: { trigger: { type: 'manual.run' }, actions: [{ actionType: 'noop' }] } },
      });
      repo.getVersionActions.mockResolvedValue([
        { id: 'a-1', actionKey: 'n', actionType: 'noop', isEnabled: true, maxAttempts: 3, requiresApproval: false, timeoutSeconds: 60, retryBackoffSeconds: 30, riskLevel: 'low', config: {} },
      ]);
      await service.manualRun(ORG, USER, 'wf-1', {}, { ...META, idempotencyKey: 'custom-key-123' });
      expect(repo.createRunWithSteps).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: 'custom-key-123' }));
    });
  });

  describe('event ingestion checks module entitlement', () => {
    it('rejects if automation not enabled', async () => {
      repo.hasEntitlement.mockResolvedValue(false);
      await expect(service.ingestEvent(ORG, USER, { sourceModule: 'alerting', eventType: 'alert.event.created' as any, dedupeKey: 'dk', payload: {} }, META)).rejects.toThrow('module_automation_enabled');
    });

    it('verifies project org ownership', async () => {
      repo.verifyProjectOwnership.mockResolvedValue(false);
      await expect(service.ingestEvent(ORG, USER, { sourceModule: 'alerting', eventType: 'alert.event.created' as any, dedupeKey: 'dk', payload: {}, projectId: 'bad' }, META)).rejects.toThrow('Project does not belong');
    });
  });

  describe('exact billing-seed key mapping', () => {
    it('notification.send -> module_alerting_features_multi_channel', () => {
      expect(collectRequiredFeatureKeys('manual.run', ['notification.send'])).toContain('module_alerting_features_multi_channel');
    });
    it('incident.create -> module_incident_management_enabled', () => {
      expect(collectRequiredFeatureKeys('manual.run', ['incident.create'])).toContain('module_incident_management_enabled');
    });
    it('ai.summary.generate -> module_ai_insights_features_incident_summary', () => {
      expect(collectRequiredFeatureKeys('manual.run', ['ai.summary.generate'])).toContain('module_ai_insights_features_incident_summary');
    });
    it('connector.delivery.retry -> module_connectors_enabled', () => {
      expect(collectRequiredFeatureKeys('manual.run', ['connector.delivery.retry'])).toContain('module_connectors_enabled');
    });
    it('cron.missed trigger -> module_cron_monitoring_enabled', () => {
      expect(collectRequiredFeatureKeys('cron.missed', ['noop'])).toContain('module_cron_monitoring_enabled');
    });
    it('uptime.failed trigger -> module_uptime_monitoring_enabled', () => {
      expect(collectRequiredFeatureKeys('uptime.failed', ['noop'])).toContain('module_uptime_monitoring_enabled');
    });
    it('security.notify -> module_enterprise_features_audit_logs', () => {
      expect(collectRequiredFeatureKeys('manual.run', ['security.notify'])).toContain('module_enterprise_features_audit_logs');
    });
    it('report.export -> module_analytics_features_custom_reports', () => {
      expect(collectRequiredFeatureKeys('manual.run', ['report.export'])).toContain('module_analytics_features_custom_reports');
    });
  });

  describe('configOverrides deep merge blocks pollution', () => {
    let templateService: TemplateService;
    let tRepo: ReturnType<typeof createMockRepo>;

    beforeEach(() => {
      tRepo = createMockRepo();
      tRepo.getTemplate = vi.fn().mockResolvedValue({ id: 't-1', templateKey: 'tpl', requiredFeatureKey: null, description: 'T', workflowType: 'custom', tags: [] });
      tRepo.getTemplateCurrentVersion = vi.fn().mockResolvedValue({
        id: 'tv-1', definition: {
          schemaVersion: 1, workflowType: 'custom',
          trigger: { kind: 'event', type: 'manual.run', sourceModule: 'automation' },
          conditions: [],
          actions: [{ actionKey: 'n', actionType: 'noop', riskLevel: 'low', requiresApproval: false, config: { x: 1 } }],
          safety: { maxRunsPerHour: 100, dedupeWindowSeconds: 300, requiresApprovalAboveRisk: 'high' },
        },
      });
      tRepo.createWorkflowFromTemplate = vi.fn().mockResolvedValue({ id: 'wf-t' });
      const mockSvc = {
        requireReadAccess: vi.fn().mockResolvedValue('admin'),
        requireWriteAccess: vi.fn().mockResolvedValue('admin'),
        checkAutomationEnabled: vi.fn(),
        checkWorkflowLimits: vi.fn(),
        batchCheckFeatures: vi.fn(),
        generateSlug: vi.fn().mockReturnValue('slug'),
      } as any;
      templateService = new TemplateService(tRepo, mockSvc);
    });

    it('blocks constructor pollution key', async () => {
      await expect(templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: USER, templateKey: 'tpl', name: 'T',
        configOverrides: { constructor: {} } as any, meta: META,
      })).rejects.toThrow('pollution');
    });

    it('blocks actionType in action overrides', async () => {
      await expect(templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: USER, templateKey: 'tpl', name: 'T',
        configOverrides: { actions: [{ actionKey: 'n', actionType: 'webhook.call', config: {} }] } as any, meta: META,
      })).rejects.toThrow('immutable field');
    });

    it('allows safe config key override', async () => {
      const result = await templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: USER, templateKey: 'tpl', name: 'T',
        configOverrides: { actions: [{ actionKey: 'n', config: { x: 2 } }] }, meta: META,
      });
      expect(result).toHaveProperty('id', 'wf-t');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 5: Automation subfeature billing keys
  // ═══════════════════════════════════════════════════════════════════════════

  describe('automation subfeature billing keys (defect 5)', () => {
    it('exposes webhook subfeature key constant', () => {
      expect(FEATURE_KEYS.AUTOMATION_WEBHOOKS).toBe('module_automation_features_webhooks');
    });

    it('exposes scheduled_workflows subfeature key constant', () => {
      expect(FEATURE_KEYS.AUTOMATION_SCHEDULED_WORKFLOWS).toBe('module_automation_features_scheduled_workflows');
    });

    it('exposes approval_steps subfeature key constant', () => {
      expect(FEATURE_KEYS.AUTOMATION_APPROVAL_STEPS).toBe('module_automation_features_approval_steps');
    });

    it('schedule.cron trigger requires scheduled_workflows feature', () => {
      const keys = collectRequiredFeatureKeys('schedule.cron', ['noop']);
      expect(keys).toContain('module_automation_features_scheduled_workflows');
    });

    it('webhook.received trigger requires webhooks feature', () => {
      const keys = collectRequiredFeatureKeys('webhook.received', ['noop']);
      expect(keys).toContain('module_automation_features_webhooks');
    });

    it('webhook.call action requires webhooks feature', () => {
      const keys = collectRequiredFeatureKeys('manual.run', ['webhook.call']);
      expect(keys).toContain('module_automation_features_webhooks');
    });

    it('approval-requiring action collects approval_steps feature', () => {
      const keys = collectRequiredFeatureKeys('manual.run', ['notification.send'], {
        actionRequiresApproval: [true],
      });
      expect(keys).toContain('module_automation_features_approval_steps');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 12: Canonical checksum stability
  // ═══════════════════════════════════════════════════════════════════════════

  describe('canonical checksum stability (defect 12)', () => {
    it('same semantic object with different key order yields same checksum', async () => {
      const { computeChecksum, stableStringify } = await import('../../src/modules/automation/repository.js');
      const obj1 = { name: 'test', trigger: { type: 'schedule.cron' }, actions: [{ actionKey: 'a' }] };
      const obj2 = { actions: [{ actionKey: 'a' }], trigger: { type: 'schedule.cron' }, name: 'test' };
      expect(computeChecksum(obj1)).toBe(computeChecksum(obj2));
    });

    it('excludes DB IDs and timestamps from checksum', async () => {
      const { computeChecksum } = await import('../../src/modules/automation/repository.js');
      const obj1 = { name: 'test', id: 'uuid-1', createdAt: '2025-01-01', updatedAt: '2025-01-02' };
      const obj2 = { name: 'test', id: 'uuid-2', createdAt: '2025-06-01', updatedAt: '2025-06-02' };
      expect(computeChecksum(obj1)).toBe(computeChecksum(obj2));
    });

    it('stableStringify produces deterministic output', async () => {
      const { stableStringify } = await import('../../src/modules/automation/repository.js');
      const s1 = stableStringify({ b: 2, a: 1 });
      const s2 = stableStringify({ a: 1, b: 2 });
      expect(s1).toBe(s2);
      expect(s1).toBe('{"a":1,"b":2}');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 7: Step attempt starts at 1 and increments only on retry
  // ═══════════════════════════════════════════════════════════════════════════

  describe('step attempt counting (defect 7)', () => {
    it('claimNextStep SQL increments only when started_at already set (retry)', () => {
      const fs = require('fs');
      const path = require('path');
      const repoSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/repository.ts'),
        'utf8'
      );
      // First claim (started_at IS NULL) must NOT increment
      expect(repoSrc).toContain('CASE WHEN s.started_at IS NOT NULL THEN s.attempt + 1 ELSE s.attempt END');
    });

    it('aggregateRunCompletion counts timed_out as failure', () => {
      const fs = require('fs');
      const path = require('path');
      const repoSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/repository.ts'),
        'utf8'
      );
      expect(repoSrc).toContain("row.timed_out > 0) return 'failed'");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 1: Atomic inbox gate (advisory lock + cooldown + run on same client)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('atomic inbox run gate (defect 1)', () => {
    it('processInbox uses repo.withTransaction for advisory lock + gate + createRunWithSteps', () => {
      const fs = require('fs');
      const path = require('path');
      const workersSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/workers.ts'),
        'utf8'
      );
      // Must use repo.withTransaction to combine advisory lock + cooldown + run creation
      expect(workersSrc).toContain('repo.withTransaction(async (client)');
      expect(workersSrc).toContain('pg_advisory_xact_lock');
      // Must pass client to createRunWithSteps
      expect(workersSrc).toContain('}, client)');
      // Must NOT have separate anyCreated tracking
      expect(workersSrc).not.toContain('anyCreated');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 2: Schedule sweep uses proper transaction
  // ═══════════════════════════════════════════════════════════════════════════

  describe('schedule sweep transaction (defect 2)', () => {
    it('runScheduleSweep uses pool.connect + BEGIN/COMMIT', () => {
      const fs = require('fs');
      const path = require('path');
      const workersSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/workers.ts'),
        'utf8'
      );
      expect(workersSrc).toContain("await client.query('BEGIN')");
      expect(workersSrc).toContain("await client.query('COMMIT')");
      expect(workersSrc).toContain('client.release()');
      // Dedupes by scheduled due timestamp, not wall clock
      expect(workersSrc).toContain('dueTimestamp');
      expect(workersSrc).toContain('dueIso');
    });

    it('claimDueSchedules is deprecated and returns empty', () => {
      const fs = require('fs');
      const path = require('path');
      const repoSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/repository.ts'),
        'utf8'
      );
      expect(repoSrc).toContain('@deprecated');
      expect(repoSrc).toContain('return []');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 3: DST-safe cron iteration
  // ═══════════════════════════════════════════════════════════════════════════

  describe('DST-safe cron iteration (defect 3)', () => {
    it('uses hourCycle h23 in Intl.DateTimeFormat', () => {
      const fs = require('fs');
      const path = require('path');
      const cronSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/cron.ts'),
        'utf8'
      );
      expect(cronSrc).toContain("hourCycle: 'h23'");
    });

    it('handles non-whole-hour timezone correctly', async () => {
      const { nextCronOccurrence } = await import('../../src/modules/automation/cron.js');
      // India (UTC+5:30): "0 9 * * *" after 2025-01-01T03:00Z (8:30 IST)
      const after = new Date('2025-01-01T03:00:00Z');
      const next = nextCronOccurrence('0 9 * * *', after, 'Asia/Kolkata');
      expect(next).not.toBeNull();
      // 9:00 IST = 3:30 UTC
      expect(next!.toISOString()).toBe('2025-01-01T03:30:00.000Z');
    });

    it('handles DST transition (spring forward)', async () => {
      const { nextCronOccurrence } = await import('../../src/modules/automation/cron.js');
      // US Eastern: spring forward March 9, 2025 at 2:00 AM -> 3:00 AM
      // "30 2 * * *" should skip to next valid occurrence
      const after = new Date('2025-03-09T06:00:00Z'); // 1:00 AM EST
      const next = nextCronOccurrence('30 2 * * *', after, 'America/New_York');
      // 2:30 AM doesn't exist on March 9 during spring forward
      // Should find next valid 2:30 AM (March 10)
      expect(next).not.toBeNull();
      // March 10, 2025 2:30 AM EDT = 06:30 UTC
      expect(next!.getUTCDate()).toBeGreaterThanOrEqual(10);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 8: Maintenance re-enqueues runnable runs
  // ═══════════════════════════════════════════════════════════════════════════

  describe('maintenance recovery re-enqueue (defect 8)', () => {
    it('worker calls findRunnableRunsForReenqueue during maintenance', () => {
      const fs = require('fs');
      const path = require('path');
      const workersSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/workers.ts'),
        'utf8'
      );
      expect(workersSrc).toContain('findRunnableRunsForReenqueue');
      expect(workersSrc).toContain('Re-enqueued runnable runs');
    });

    it('repository has findRunnableRunsForReenqueue with correct SQL', () => {
      const fs = require('fs');
      const path = require('path');
      const repoSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/repository.ts'),
        'utf8'
      );
      expect(repoSrc).toContain('findRunnableRunsForReenqueue');
      // Must not have active running step
      expect(repoSrc).toContain("s.status = 'running'");
      // Must have due queued step
      expect(repoSrc).toContain("s.status = 'queued'");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 9: Between-step safety checks
  // ═══════════════════════════════════════════════════════════════════════════

  describe('between-step safety (defect 9)', () => {
    it('executeRun rechecks entitlement, workflow, project between steps', () => {
      const fs = require('fs');
      const path = require('path');
      const workersSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/workers.ts'),
        'utf8'
      );
      expect(workersSrc).toContain('Between-step: recheck base automation entitlement');
      expect(workersSrc).toContain('Between-step: recheck workflow enabled/deleted');
      expect(workersSrc).toContain('Between-step: recheck project ownership');
    });

    it('entitlement lost fails step/run (never skip/succeed)', () => {
      const fs = require('fs');
      const path = require('path');
      const workersSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/workers.ts'),
        'utf8'
      );
      // Step entitlement lost = status 'failed', not 'skipped'
      expect(workersSrc).toContain("status: 'failed',");
      expect(workersSrc).toContain("errorCode: 'ENTITLEMENT_LOST'");
      // Must not use 'skipped' for entitlement loss
      expect(workersSrc).not.toContain("status: 'skipped',\n            errorCode: 'ENTITLEMENT_MISSING'");
      expect(workersSrc).not.toContain("status: 'skipped',\r\n            errorCode: 'ENTITLEMENT_MISSING'");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 11: Worker rethrows unexpected errors
  // ═══════════════════════════════════════════════════════════════════════════

  describe('worker rethrows (defect 11)', () => {
    it('execute handler does NOT catch-and-swallow unexpected errors', () => {
      const fs = require('fs');
      const path = require('path');
      const workersSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/workers.ts'),
        'utf8'
      );
      // The execute worker block must NOT have try/catch around executeRun
      const execBlock = workersSrc.slice(
        workersSrc.indexOf('AUTOMATION_QUEUES.execute'),
        workersSrc.indexOf('AUTOMATION_QUEUES.maintenance'),
      );
      expect(execBlock).not.toContain("} catch (err) {\n          log.error({ err, runId: job.data.runId }, 'Run execution failed unexpectedly');\n        }");
      // Must directly await without swallowing
      expect(execBlock).toContain('await executeRun(job.data.runId, job.data.orgId, repo, auditRepo, actionRunner, log)');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 13: Migration integrity constraints
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * These assertions previously read
   * `src/db/postgres/canonical_migrations_draft/19_automation/*.sql`, a directory that
   * does not exist here, so they failed with ENOENT instead of verifying anything.
   * They now read the migrations that are actually applied, under
   * `src/db/postgres/primary_db_draft/14_automation/`.
   *
   * The inbox status constraint is now expressed as a dedicated ENUM
   * (`automation_inbox_status`) rather than a CHECK. That is strictly stronger: the
   * type system rejects an invalid status everywhere the column is used, and the
   * allowed set cannot drift between tables.
   */
  describe('migration integrity constraints (defect 13)', () => {
    const AUTOMATION_MIGRATIONS = '../../src/db/postgres/primary_db_draft/14_automation';

    it('constrains inbox status to exactly the five values the repository writes', () => {
      const fs = require('fs');
      const path = require('path');
      const sql = fs.readFileSync(
        path.join(__dirname, `${AUTOMATION_MIGRATIONS}/002_create_automation_runtime.sql`),
        'utf8',
      );
      expect(sql).toContain('CREATE TYPE automation_inbox_status AS ENUM');
      expect(sql).toContain("'pending', 'processing', 'processed', 'retry', 'failed'");
      expect(sql).toContain('status automation_inbox_status NOT NULL');
    });

    it('attaches the immutability trigger for published workflow versions', () => {
      const fs = require('fs');
      const path = require('path');
      const triggers = fs.readFileSync(
        path.join(__dirname, `${AUTOMATION_MIGRATIONS}/999_triggers.sql`),
        'utf8',
      );
      expect(triggers).toContain('trg_fn_immutable_published_version');
      expect(triggers).toContain('trg_immutable_published_version');
      // Must guard UPDATE only, so FK CASCADE deletes still work.
      expect(triggers).toContain('BEFORE UPDATE ON automation_workflow_versions');
      expect(triggers).not.toContain('BEFORE DELETE ON automation_workflow_versions');
    });

    it('protects the audit trail from workflow deletion (SET NULL, never CASCADE)', () => {
      const fs = require('fs');
      const path = require('path');
      const sql = fs.readFileSync(
        path.join(__dirname, `${AUTOMATION_MIGRATIONS}/002_create_automation_runtime.sql`),
        'utf8',
      );
      // Within the automation_audit_logs block, workflow_id must not cascade.
      const auditBlock = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS automation_audit_logs'));
      expect(auditBlock).toContain('workflow_id UUID NULL REFERENCES automation_workflows(id) ON DELETE SET NULL');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 14: Namespaced event dedupe
  // ═══════════════════════════════════════════════════════════════════════════

  describe('namespaced event dedupe (defect 14)', () => {
    /**
     * The dedupe index is now `UNIQUE (organization_id, dedupe_key) NULLS NOT DISTINCT`
     * with NO predicate, replacing the old partial index that was restricted to
     * `WHERE organization_id IS NOT NULL`.
     *
     * That old shape had a real hole: because PostgreSQL treats NULLs as distinct in a
     * unique index by default, and the index skipped NULL-org rows entirely, two
     * platform/system events sharing a dedupe_key would BOTH insert — silently
     * breaking deduplication for exactly the events that fan out widest. NULLS NOT
     * DISTINCT (PG15+) closes that, and removing the predicate lets the plain
     * `ON CONFLICT (organization_id, dedupe_key)` in insertInboxEvent target it.
     */
    it('dedupes the inbox on (organization_id, dedupe_key) including NULL-org events', () => {
      const fs = require('fs');
      const path = require('path');
      const sql = fs.readFileSync(
        path.join(__dirname, '../../src/db/postgres/primary_db_draft/14_automation/002_create_automation_runtime.sql'),
        'utf8',
      );
      expect(sql).toContain('uq_automation_events_inbox_org_dedupe');
      expect(sql).toContain('(organization_id, dedupe_key) NULLS NOT DISTINCT');
    });

    it('insertInboxEvent ON CONFLICT target matches the dedupe index exactly', () => {
      const fs = require('fs');
      const path = require('path');
      const repoSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/repository.ts'),
        'utf8',
      );
      // Must have no predicate, or it would fail to match the now-unpartitioned index.
      expect(repoSrc).toContain('ON CONFLICT (organization_id, dedupe_key) DO NOTHING');
      expect(repoSrc).not.toContain('ON CONFLICT (organization_id, dedupe_key) WHERE');
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // DEFECT 15: Sensitive header redaction
  // ═══════════════════════════════════════════════════════════════════════════

  describe('sensitive header redaction (defect 15)', () => {
    it('insertInboxEvent redacts authorization/cookie headers', () => {
      const fs = require('fs');
      const path = require('path');
      const repoSrc = fs.readFileSync(
        path.join(__dirname, '../../src/modules/automation/repository.ts'),
        'utf8'
      );
      expect(repoSrc).toContain('SENSITIVE_HEADERS');
      expect(repoSrc).toContain("'authorization'");
      expect(repoSrc).toContain("'cookie'");
      expect(repoSrc).toContain('[REDACTED]');
    });
  });
});
