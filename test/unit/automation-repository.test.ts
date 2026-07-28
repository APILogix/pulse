/**
 * Automation Repository — Unit Tests (mocked pg)
 *
 * Tests prove: transactions, org filters, draft v1, SKIP LOCKED,
 * duplicate inbox/run handling, template normalization, approval atomicity, and audit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AutomationRepository } from '../../src/modules/automation/repository.js';

// ---------------------------------------------------------------------------
// Mock pg Pool/Client
// ---------------------------------------------------------------------------

interface MockQuery {
  text?: string;
  values?: unknown[];
}

function createMockClient() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  return {
    queries,
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params: params ?? [] });
      // Default: return empty rows
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
}

function createMockPool(client = createMockClient()) {
  return {
    client,
    pool: {
      connect: vi.fn(async () => client),
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        return client.query(sql, params);
      }),
    } as unknown as import('pg').Pool,
  };
}

// Helpers to set up mock return values
function mockQueryReturn(client: ReturnType<typeof createMockClient>, callIndex: number, rows: Record<string, unknown>[], rowCount?: number) {
  let callCount = 0;
  const original = client.query;
  client.query = vi.fn(async (sql: string, params?: unknown[]) => {
    const result = original.getMockImplementation()
      ? await (original as any)(sql, params)
      : { rows: [], rowCount: 0 };
    if (callCount === callIndex) {
      callCount++;
      return { rows, rowCount: rowCount ?? rows.length };
    }
    callCount++;
    return result;
  }) as any;
}

function mockSequentialReturns(client: ReturnType<typeof createMockClient>, returns: Array<{ rows: Record<string, unknown>[]; rowCount?: number }>) {
  let callCount = 0;
  client.query = vi.fn(async (sql: string, params?: unknown[]) => {
    const ret = returns[callCount] ?? { rows: [], rowCount: 0 };
    callCount++;
    return { rows: ret.rows, rowCount: ret.rowCount ?? ret.rows.length };
  }) as any;
}

// Sample workflow row for mocking
const sampleWorkflowRow = {
  id: 'wf-001',
  organization_id: 'org-001',
  project_id: null,
  created_by: 'user-001',
  updated_by: 'user-001',
  template_id: null,
  name: 'Test Workflow',
  slug: 'test-workflow',
  description: 'A test',
  workflow_type: 'custom',
  scope: 'organization',
  status: 'draft',
  is_enabled: false,
  current_version: 1,
  last_run_at: null,
  next_run_at: null,
  timezone: 'UTC',
  tags: [],
  metadata: {},
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
  deleted_at: null,
};

const sampleRunRow = {
  id: 'run-001',
  organization_id: 'org-001',
  project_id: null,
  workflow_id: 'wf-001',
  workflow_version_id: 'ver-001',
  trigger_id: null,
  inbox_event_id: null,
  status: 'queued',
  trigger_type: 'manual.run',
  source_module: 'automation',
  source_event_id: null,
  dedupe_key: null,
  idempotency_key: 'idem-001',
  priority: 0,
  queued_at: new Date(),
  started_at: null,
  completed_at: null,
  cancelled_at: null,
  expires_at: null,
  attempt: 1,
  max_attempts: 3,
  input_payload: {},
  output_payload: {},
  error_code: null,
  error_message: null,
  metadata: {},
  created_at: new Date(),
  updated_at: new Date(),
};

describe('AutomationRepository', () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let mockPool: ReturnType<typeof createMockPool>;
  let repo: AutomationRepository;

  beforeEach(() => {
    mockClient = createMockClient();
    mockPool = createMockPool(mockClient);
    repo = new AutomationRepository(mockPool.pool);
  });

  // =========================================================================
  // Transaction tests
  // =========================================================================

  describe('withTransaction', () => {
    it('commits on success', async () => {
      mockSequentialReturns(mockClient, [
        { rows: [] }, // BEGIN
        { rows: [{ val: 42 }] }, // user query
        { rows: [] }, // COMMIT
      ]);

      const result = await repo.withTransaction(async (client) => {
        const r = await client.query('SELECT 42 AS val');
        return r.rows[0].val;
      });

      expect(result).toBe(42);
      const sqls = mockClient.queries.map(q => q.sql);
      // The mock captures via vi.fn calls
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
      expect(mockClient.release).toHaveBeenCalled();
    });

    it('rolls back on error', async () => {
      mockSequentialReturns(mockClient, [
        { rows: [] }, // BEGIN
        { rows: [] }, // will throw
        { rows: [] }, // ROLLBACK
      ]);

      // Override second call to throw
      let callIdx = 0;
      mockClient.query = vi.fn(async (sql: string, params?: unknown[]) => {
        callIdx++;
        if (callIdx === 2) throw new Error('DB fail');
        return { rows: [], rowCount: 0 };
      }) as any;

      await expect(repo.withTransaction(async (client) => {
        await client.query('SELECT fail');
      })).rejects.toThrow('DB fail');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Org filters
  // =========================================================================

  describe('org-scoped queries', () => {
    it('listWorkflows includes org_id filter via v_automation_workflow_summaries view', async () => {
      mockSequentialReturns(mockClient, [
        { rows: [{ total: 0 }] },
        { rows: [] },
      ]);

      await repo.listWorkflows('org-001', { limit: 10, offset: 0 });

      const firstCall = (mockClient.query as any).mock.calls[0];
      expect(firstCall[0]).toContain('organization_id = $1');
      expect(firstCall[0]).toContain('v_automation_workflow_summaries');
      expect(firstCall[1]).toEqual(['org-001']);
    });

    it('getWorkflow filters by org and non-deleted', async () => {
      mockSequentialReturns(mockClient, [
        { rows: [] },
      ]);

      const result = await repo.getWorkflow('org-001', 'wf-missing');
      expect(result).toBeNull();

      const call = (mockClient.query as any).mock.calls[0];
      expect(call[0]).toContain('organization_id = $2');
      expect(call[0]).toContain('deleted_at IS NULL');
    });

    it('listRuns scopes by organization_id', async () => {
      mockSequentialReturns(mockClient, [
        { rows: [{ total: 1 }] },
        { rows: [sampleRunRow] },
      ]);

      const result = await repo.listRuns('org-001', { limit: 10, offset: 0 });
      expect(result.total).toBe(1);
      expect(result.data[0].organizationId).toBe('org-001');
    });
  });

  // =========================================================================
  // Project ownership fix (projects.org_id)
  // =========================================================================

  describe('verifyProjectOwnership', () => {
    it('uses projects.org_id (not organization_id)', async () => {
      mockSequentialReturns(mockClient, [
        { rows: [{ '?column?': 1 }], rowCount: 1 },
      ]);

      const result = await repo.verifyProjectOwnership('org-001', 'proj-001');
      expect(result).toBe(true);

      const call = (mockClient.query as any).mock.calls[0];
      // The key fix: must use org_id not organization_id
      expect(call[0]).toContain('org_id = $2');
      expect(call[0]).not.toContain('organization_id = $2');
    });
  });


  // =========================================================================
  // Draft v1 creation in createWorkflowTransaction
  // =========================================================================

  describe('createWorkflowTransaction', () => {
    it('creates workflow + draft v1 version + trigger + conditions + actions in transaction', async () => {
      // Mock transaction calls: BEGIN, INSERT workflow, INSERT version, INSERT trigger, INSERT condition, INSERT action, COMMIT
      const calls: string[] = [];
      let callCount = 0;
      mockClient.query = vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push(sql);
        callCount++;
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
          return { rows: [], rowCount: 0 };
        }
        // Return workflow row for the INSERT INTO automation_workflows
        if (sql.includes('INSERT INTO automation_workflows')) {
          return { rows: [sampleWorkflowRow], rowCount: 1 };
        }
        // Return version row
        if (sql.includes('INSERT INTO automation_workflow_versions')) {
          return { rows: [{ id: 'ver-001', workflow_id: 'wf-001', version: 1, status: 'draft' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }) as any;

      const result = await repo.createWorkflowTransaction({
        orgId: 'org-001',
        createdBy: 'user-001',
        name: 'Test Workflow',
        slug: 'test-workflow',
        workflowType: 'custom',
        trigger: {
          triggerKind: 'event',
          triggerType: 'alert.event.created',
          sourceModule: 'alerting',
          sourceEvent: 'alert.event.created',
        },
        conditions: [
          { leftPath: '$.severity', operator: 'eq', rightValue: 'critical' },
        ],
        actions: [
          { actionKey: 'notify', actionType: 'notification.send' },
        ],
      });

      expect(result.id).toBe('wf-001');

      // Verify transaction lifecycle
      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('COMMIT');

      // Verify draft v1 was created
      const versionInsert = calls.find(s => s.includes('automation_workflow_versions'));
      expect(versionInsert).toBeDefined();
      expect(versionInsert).toContain("'draft'");

      // Verify trigger insert
      const triggerInsert = calls.find(s => s.includes('automation_triggers'));
      expect(triggerInsert).toBeDefined();

      // Verify condition insert
      const conditionInsert = calls.find(s => s.includes('automation_conditions'));
      expect(conditionInsert).toBeDefined();

      // Verify action insert
      const actionInsert = calls.find(s => s.includes('automation_actions'));
      expect(actionInsert).toBeDefined();
    });
  });

  // =========================================================================
  // SKIP LOCKED inbox claim
  // =========================================================================

  describe('claimInboxEvents', () => {
    it('uses FOR UPDATE SKIP LOCKED with bounded batch', async () => {
      const inboxRow = {
        id: 'evt-001', organization_id: 'org-001', project_id: null,
        source_module: 'alerting', event_type: 'alert.event.created',
        source_event_id: null, dedupe_key: 'dedupe-1', payload: {},
        headers: {}, status: 'processing', received_at: new Date(),
        locked_at: new Date(), locked_by: 'worker-1', processed_at: null,
        attempts: 1, next_retry_at: null, last_error: null, metadata: {},
      };
      mockSequentialReturns(mockClient, [
        { rows: [inboxRow] },
      ]);

      const result = await repo.claimInboxEvents('worker-1', 5);
      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('processing');

      const sql = (mockClient.query as any).mock.calls[0][0] as string;
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain('LIMIT $1');

      const params = (mockClient.query as any).mock.calls[0][1];
      expect(params[0]).toBe(5); // batch size
      expect(params[1]).toBe('worker-1'); // worker id
    });

    it('recovers stuck events locked > 5 minutes', async () => {
      mockSequentialReturns(mockClient, [{ rows: [] }]);
      await repo.claimInboxEvents('worker-1', 10);

      const sql = (mockClient.query as any).mock.calls[0][0] as string;
      expect(sql).toContain("locked_at < NOW() - INTERVAL '5 minutes'");
    });
  });

  // =========================================================================
  // Duplicate inbox handling (idempotent insert)
  // =========================================================================

  describe('insertInboxEvent', () => {
    it('returns { event, created: false } on duplicate dedupe_key (ON CONFLICT DO NOTHING)', async () => {
      const existingRow = {
        id: 'evt-existing', organization_id: 'org-001', project_id: null,
        source_module: 'alerting', event_type: 'alert.event.created',
        source_event_id: null, dedupe_key: 'dup-key', payload: { old: true },
        headers: {}, status: 'pending', received_at: new Date(),
        locked_at: null, locked_by: null, processed_at: null,
        attempts: 0, next_retry_at: null, last_error: null, metadata: {},
      };

      // First INSERT returns no rows (conflict), second SELECT returns existing
      mockSequentialReturns(mockClient, [
        { rows: [], rowCount: 0 }, // INSERT ... ON CONFLICT DO NOTHING (no RETURNING)
        { rows: [existingRow] },   // org-scoped SELECT fallback
      ]);

      const result = await repo.insertInboxEvent({
        organizationId: 'org-001',
        sourceModule: 'alerting',
        eventType: 'alert.event.created',
        dedupeKey: 'dup-key',
        payload: { new: true },
      });

      expect(result.created).toBe(false);
      expect(result.event.id).toBe('evt-existing');
      expect(result.event.payload).toEqual({ old: true });

      // Verify ON CONFLICT
      const insertSql = (mockClient.query as any).mock.calls[0][0] as string;
      expect(insertSql).toContain('ON CONFLICT (organization_id, dedupe_key) WHERE organization_id IS NOT NULL DO NOTHING');
      // Verify org-scoped lookup
      const selectSql = (mockClient.query as any).mock.calls[1][0] as string;
      expect(selectSql).toContain('organization_id = $2');
    });
  });

  // =========================================================================
  // Duplicate run handling (idempotency_key unique constraint)
  // =========================================================================

  describe('createRunWithSteps', () => {
    it('maps pg unique violation on idempotency_key to AutomationConflictError', async () => {
      // BEGIN, then INSERT that throws unique violation
      let callCount = 0;
      mockClient.query = vi.fn(async (sql: string, params?: unknown[]) => {
        callCount++;
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('INSERT INTO automation_runs')) {
          const err = new Error('duplicate key') as any;
          err.code = '23505';
          err.constraint = 'automation_runs_idempotency_key_key';
          throw err;
        }
        return { rows: [], rowCount: 0 };
      }) as any;

      await expect(repo.createRunWithSteps({
        organizationId: 'org-001',
        workflowId: 'wf-001',
        workflowVersionId: 'ver-001',
        triggerType: 'manual.run',
        sourceModule: 'automation',
        idempotencyKey: 'dup-idem',
        inputPayload: {},
        steps: [],
      })).rejects.toThrow(/Conflict/);
    });
  });


  // =========================================================================
  // Template normalization (createWorkflowFromTemplate)
  // =========================================================================

  describe('createWorkflowFromTemplate', () => {
    it('materializes trigger/conditions/actions from template definition', async () => {
      const calls: string[] = [];
      const templateRow = {
        id: 'tmpl-001', template_key: 'alert-route', scope: 'platform',
        organization_id: null, name: 'Alert Route', description: 'Routes alerts',
        workflow_type: 'alert_routing', category: 'alerting',
        is_active: true, is_public: true, is_featured: false,
        minimum_plan_tier: null, required_feature_key: null,
        tags: ['alerting'], sort_order: 0, metadata: {},
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      };
      const versionRow = {
        id: 'tv-001', template_id: 'tmpl-001', version: 1, is_current: true,
        definition: {
          trigger: { kind: 'event', type: 'alert.event.created', sourceModule: 'alerting', sourceEvent: 'alert.event.created' },
          conditions: [{ leftPath: '$.severity', operator: 'in', rightValue: ['critical'] }],
          actions: [{ actionKey: 'notify_team', actionType: 'notification.send', riskLevel: 'low', config: { channel: '#alerts' } }],
        },
        trigger_summary: [], condition_summary: [], action_summary: [],
        created_by: null, published_at: new Date(), checksum: 'abc123',
        metadata: {}, created_at: new Date(),
      };

      mockClient.query = vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push(sql);
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('FROM automation_templates WHERE id')) return { rows: [templateRow], rowCount: 1 };
        if (sql.includes('automation_template_versions')) return { rows: [versionRow], rowCount: 1 };
        if (sql.includes('INSERT INTO automation_workflows')) return { rows: [{ ...sampleWorkflowRow, template_id: 'tmpl-001' }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }) as any;

      await repo.createWorkflowFromTemplate({
        orgId: 'org-001',
        createdBy: 'user-001',
        templateId: 'tmpl-001',
        name: 'My Alert Route',
        slug: 'my-alert-route',
      });

      // Verify trigger was materialized
      const triggerInsert = calls.find(s => s.includes('INSERT INTO automation_triggers'));
      expect(triggerInsert).toBeDefined();

      // Verify condition was materialized
      const condInsert = calls.find(s => s.includes('INSERT INTO automation_conditions'));
      expect(condInsert).toBeDefined();

      // Verify action was materialized
      const actInsert = calls.find(s => s.includes('INSERT INTO automation_actions'));
      expect(actInsert).toBeDefined();

      // Verify draft v1 version was created
      const verInsert = calls.find(s => s.includes('INSERT INTO automation_workflow_versions'));
      expect(verInsert).toBeDefined();
    });
  });

  // =========================================================================
  // Approval atomicity
  // =========================================================================

  describe('approveApproval', () => {
    it('locks row with FOR UPDATE and validates pending + not expired', async () => {
      const pendingApproval = {
        id: 'appr-001', organization_id: 'org-001', workflow_id: 'wf-001',
        run_id: 'run-001', step_id: 'step-001', requested_by: 'user-001',
        approved_by: null, rejected_by: null, status: 'pending',
        risk_level: 'high', approval_reason: null, rejection_reason: null,
        expires_at: new Date(Date.now() + 3600_000), // 1 hour from now
        decided_at: null, request_payload: {}, decision_payload: {},
        metadata: {}, created_at: new Date(), updated_at: new Date(),
      };

      const approvedApproval = { ...pendingApproval, status: 'approved', approved_by: 'admin-001', decided_at: new Date() };

      const calls: string[] = [];
      mockClient.query = vi.fn(async (sql: string, params?: unknown[]) => {
        calls.push(sql);
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('FOR UPDATE')) return { rows: [pendingApproval], rowCount: 1 };
        if (sql.includes('UPDATE automation_approvals')) return { rows: [approvedApproval], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }) as any;

      const result = await repo.approveApproval('org-001', 'appr-001', 'admin-001', 'Looks good');
      expect(result.status).toBe('approved');

      // Verify FOR UPDATE lock was used
      const lockSql = calls.find(s => s.includes('FOR UPDATE'));
      expect(lockSql).toBeDefined();

      // Verify step was resumed
      const stepResume = calls.find(s => s.includes('UPDATE automation_run_steps') && s.includes("'queued'"));
      expect(stepResume).toBeDefined();
    });

    it('throws on expired approval', async () => {
      const expiredApproval = {
        id: 'appr-002', organization_id: 'org-001', workflow_id: 'wf-001',
        run_id: 'run-001', step_id: 'step-001', requested_by: 'user-001',
        approved_by: null, rejected_by: null, status: 'pending',
        risk_level: 'high', approval_reason: null, rejection_reason: null,
        expires_at: new Date(Date.now() - 3600_000), // 1 hour ago
        decided_at: null, request_payload: {}, decision_payload: {},
        metadata: {}, created_at: new Date(), updated_at: new Date(),
      };

      mockClient.query = vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('FOR UPDATE')) return { rows: [expiredApproval], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }) as any;

      await expect(repo.approveApproval('org-001', 'appr-002', 'admin-001'))
        .rejects.toThrow(/expired/i);
    });

    it('throws on already-decided approval', async () => {
      const decidedApproval = {
        id: 'appr-003', organization_id: 'org-001', workflow_id: 'wf-001',
        run_id: 'run-001', step_id: null, requested_by: 'user-001',
        approved_by: 'admin-001', rejected_by: null, status: 'approved',
        risk_level: 'high', approval_reason: 'ok', rejection_reason: null,
        expires_at: new Date(Date.now() + 3600_000),
        decided_at: new Date(), request_payload: {}, decision_payload: {},
        metadata: {}, created_at: new Date(), updated_at: new Date(),
      };

      mockClient.query = vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
        if (sql.includes('FOR UPDATE')) return { rows: [decidedApproval], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }) as any;

      await expect(repo.approveApproval('org-001', 'appr-003', 'admin-002'))
        .rejects.toThrow(/already approved/i);
    });
  });

  // =========================================================================
  // Audit log immutability
  // =========================================================================

  describe('insertAuditLog', () => {
    it('inserts audit log with all fields parameterized', async () => {
      mockSequentialReturns(mockClient, [{ rows: [] }]);

      await repo.insertAuditLog({
        organizationId: 'org-001',
        workflowId: 'wf-001',
        action: 'workflow.created',
        entityType: 'workflow',
        entityId: 'wf-001',
        actorUserId: 'user-001',
        ipAddress: '10.0.0.1',
      });

      const call = (mockClient.query as any).mock.calls[0];
      const sql = call[0] as string;
      expect(sql).toContain('INSERT INTO automation_audit_logs');
      // Verify parameterized (no string interpolation)
      expect(sql).not.toContain("'org-001'");
      expect(sql).not.toContain("'wf-001'");
      // All values via $N params
      const params = call[1] as unknown[];
      expect(params).toContain('org-001');
      expect(params).toContain('workflow.created');
    });
  });

  // =========================================================================
  // Step claim uses SKIP LOCKED + actual timeout
  // =========================================================================

  describe('claimNextStep', () => {
    it('uses SKIP LOCKED and computes timeout from action timeout_seconds', async () => {
      const stepRow = {
        id: 'step-001', run_id: 'run-001', workflow_id: 'wf-001',
        action_id: 'act-001', step_key: 'notify', action_type: 'notification.send',
        status: 'running', sort_order: 0, attempt: 1, max_attempts: 3,
        started_at: new Date(), completed_at: null, next_retry_at: null,
        timeout_at: new Date(Date.now() + 60000), requires_approval: false,
        approval_id: null, idempotency_key: null, input_payload: {},
        output_payload: {}, error_code: null, error_message: null,
        metadata: {}, created_at: new Date(), updated_at: new Date(),
      };

      mockSequentialReturns(mockClient, [{ rows: [stepRow] }]);

      const result = await repo.claimNextStep('run-001', 1);
      expect(result).toHaveLength(1);

      const sql = (mockClient.query as any).mock.calls[0][0] as string;
      expect(sql).toContain('SKIP LOCKED');
      expect(sql).toContain('timeout_seconds');
      // Verify it checks workflow is enabled and not deleted
      expect(sql).toContain('w.is_enabled = TRUE');
      expect(sql).toContain('w.deleted_at IS NULL');
    });
  });

  // =========================================================================
  // Entitlement uses canonical effective SQL
  // =========================================================================

  describe('hasEntitlement', () => {
    it('queries using effective entitlements SQL with past_due support', async () => {
      mockSequentialReturns(mockClient, [
        { rows: [{ has_access: true }] },
      ]);

      const result = await repo.hasEntitlement('org-001', 'module_automation_enabled');
      expect(result).toBe(true);

      const sql = (mockClient.query as any).mock.calls[0][0] as string;
      // Canonical entitlements include past_due
      expect(sql).toContain('past_due');
      // Includes overrides
      expect(sql).toContain('organization_feature_overrides');
      // Includes add-ons
      expect(sql).toContain('subscription_addons');
    });
  });
});
