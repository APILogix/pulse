/**
 * Unit tests for TemplateService.
 * Tests: template listing with entitlement enrichment, get template,
 * create-workflow-from-template validation, slug generation, entitlement gate.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateService } from '../../src/modules/automation/template.service.js';

function createMockRepo() {
  return {
    hasEntitlement: vi.fn().mockResolvedValue(true),
    getWorkflowLimit: vi.fn().mockResolvedValue(-1),
    countOrgWorkflows: vi.fn().mockResolvedValue(2),
    verifyProjectOwnership: vi.fn().mockResolvedValue(true),
    batchCheckEntitlements: vi.fn().mockImplementation((_orgId: string, keys: string[]) => {
      const map = new Map<string, boolean>();
      for (const k of keys) map.set(k, true);
      return Promise.resolve(map);
    }),
    listTemplates: vi.fn().mockResolvedValue({
      data: [
        {
          id: 't-1', templateKey: 'alert-route-by-service-severity', scope: 'platform',
          organizationId: null, name: 'Route by Service', description: 'Routes alerts',
          workflowType: 'alert_routing', category: 'alerting', isActive: true,
          isPublic: true, isFeatured: true, minimumPlanTier: 'professional',
          requiredFeatureKey: 'module_alerting_features_multi_channel',
          tags: ['alerting'], sortOrder: 0, metadata: {},
          createdAt: new Date(), updatedAt: new Date(), deletedAt: null,
        },
      ],
      total: 1,
    }),
    getTemplate: vi.fn().mockResolvedValue({
      id: 't-1', templateKey: 'alert-route-by-service-severity', scope: 'platform',
      organizationId: null, name: 'Route by Service', description: 'Routes alerts',
      workflowType: 'alert_routing', category: 'alerting', isActive: true,
      requiredFeatureKey: 'module_alerting_features_multi_channel',
      tags: ['alerting'], metadata: {},
    }),
    getTemplateCurrentVersion: vi.fn().mockResolvedValue({
      id: 'tv-1', templateId: 't-1', version: 1, isCurrent: true,
      definition: {
        schemaVersion: 1, workflowType: 'alert_routing',
        trigger: { kind: 'event', type: 'alert.event.created', sourceModule: 'alerting' },
        conditions: [{ leftPath: '$.severity', operator: 'in', rightValue: ['critical', 'fatal'] }],
        actions: [{ actionKey: 'notify', actionType: 'notification.send', riskLevel: 'low', requiresApproval: false, config: {} }],
        safety: { maxRunsPerHour: 100, dedupeWindowSeconds: 300, requiresApprovalAboveRisk: 'high' },
      },
      triggerSummary: [], conditionSummary: [], actionSummary: [],
      checksum: 'abc', metadata: {}, createdAt: new Date(), publishedAt: new Date(),
    }),
    createWorkflowFromTemplate: vi.fn().mockResolvedValue({
      id: 'wf-from-t', name: 'My Alert Router', slug: 'my-alert-router', status: 'draft',
    }),
  } as any;
}

function createMockService() {
  return {
    requireReadAccess: vi.fn().mockResolvedValue('admin'),
    requireWriteAccess: vi.fn().mockResolvedValue('admin'),
    checkAutomationEnabled: vi.fn().mockResolvedValue(undefined),
    checkWorkflowLimits: vi.fn().mockResolvedValue(undefined),
    batchCheckFeatures: vi.fn().mockResolvedValue(undefined),
    generateSlug: vi.fn().mockReturnValue('my-alert-router'),
  } as any;
}

const META = { actorUserId: 'user-1', actorIp: '127.0.0.1', actorUserAgent: 'test', requestId: 'req-1' };
const ORG = 'org-1';

describe('TemplateService', () => {
  let repo: ReturnType<typeof createMockRepo>;
  let svc: ReturnType<typeof createMockService>;
  let templateService: TemplateService;

  beforeEach(() => {
    repo = createMockRepo();
    svc = createMockService();
    templateService = new TemplateService(repo, svc);
  });

  describe('listTemplates', () => {
    it('enriches templates with availability info', async () => {
      const result = await templateService.listTemplates(ORG, 'user-1', { limit: 50, offset: 0 });
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toHaveProperty('automationAvailable', true);
      expect(result.data[0]).toHaveProperty('templateKey', 'alert-route-by-service-severity');
    });

    it('marks template unavailable when entitlement missing', async () => {
      repo.batchCheckEntitlements.mockImplementation((_orgId: string, keys: string[]) => {
        const map = new Map<string, boolean>();
        for (const k of keys) map.set(k, false);
        return Promise.resolve(map);
      });
      const result = await templateService.listTemplates(ORG, 'user-1', { limit: 50, offset: 0 });
      expect(result.data[0]!.automationAvailable).toBe(false);
      expect(result.data[0]!.unavailableReason).toContain('module_alerting_features_multi_channel');
    });
  });

  describe('getTemplate', () => {
    it('returns template with current version', async () => {
      const result = await templateService.getTemplate(ORG, 'user-1', 'alert-route-by-service-severity');
      expect(result.template).toHaveProperty('templateKey', 'alert-route-by-service-severity');
      expect(result.version).toHaveProperty('version', 1);
    });

    it('throws if template not found', async () => {
      repo.getTemplate.mockResolvedValue(null);
      await expect(templateService.getTemplate(ORG, 'user-1', 'nonexistent'))
        .rejects.toThrow('not found');
    });
  });

  describe('createWorkflowFromTemplate', () => {
    it('creates workflow from valid template', async () => {
      const result = await templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: 'user-1', templateKey: 'alert-route-by-service-severity',
        name: 'My Alert Router', meta: META,
      });
      expect(result).toHaveProperty('id', 'wf-from-t');
      expect(repo.createWorkflowFromTemplate).toHaveBeenCalledTimes(1);
    });

    it('throws when required entitlement missing', async () => {
      repo.hasEntitlement.mockResolvedValue(false);
      await expect(templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: 'user-1', templateKey: 'alert-route-by-service-severity',
        name: 'My Router', meta: META,
      })).rejects.toThrow('module_alerting_features_multi_channel');
    });

    it('throws when template not found', async () => {
      repo.getTemplate.mockResolvedValue(null);
      await expect(templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: 'user-1', templateKey: 'nonexistent', name: 'Test', meta: META,
      })).rejects.toThrow('not found');
    });

    it('throws when template version not found', async () => {
      repo.getTemplateCurrentVersion.mockResolvedValue(null);
      await expect(templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: 'user-1', templateKey: 'alert-route-by-service-severity',
        name: 'Test', meta: META,
      })).rejects.toThrow('not found');
    });

    it('validates project belongs to org', async () => {
      repo.verifyProjectOwnership.mockResolvedValue(false);
      await expect(templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: 'user-1', templateKey: 'alert-route-by-service-severity',
        name: 'Test', projectId: 'p-bad', meta: META,
      })).rejects.toThrow('Project does not belong');
    });

    it('checks workflow limits', async () => {
      svc.checkWorkflowLimits.mockRejectedValue(new Error('Limit exceeded'));
      await expect(templateService.createWorkflowFromTemplate({
        orgId: ORG, userId: 'user-1', templateKey: 'alert-route-by-service-severity',
        name: 'Test', meta: META,
      })).rejects.toThrow('Limit exceeded');
    });
  });
});
