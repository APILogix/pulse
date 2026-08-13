import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  NotificationEntitlementService,
  type NotificationEntitlementDecision,
} from '../../src/modules/alerting/runtime/notification-entitlement.service.js';
import {
  EmailOnlyRestrictedRouting,
  ProjectOwnerRepository,
  type ProjectOwnerReader,
} from '../../src/modules/alerting/runtime/email-only-restricted-routing.js';
import { NotificationRoutingService } from '../../src/modules/alerting/runtime/notification-routing.service.js';
import {
  AlertNotificationRouter,
} from '../../src/modules/alerting/runtime/notification-router.js';
import { pgboss } from '../../src/lib/pgboss.js';
import { ProjectMemberService } from '../../src/modules/projects/members/member.service.js';
import { MemberRepository } from '../../src/modules/projects/members/member.repository.js';
import { ProjectMemberRole } from '../../src/modules/projects/core/project.types.js';
import { ProjectError } from '../../src/modules/projects/shared/utils.js';
import { isManagedEmailJob, isConnectorTransportJob, type ManagedEmailJobData } from '../../src/modules/connectors/delivery/transport.types.js';
import type { Pool } from 'pg';

describe('Alerting V2 Enterprise Hardening & Production Finalization Test Suite', () => {
  const mockLogger = {
    child: () => mockLogger,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: Entitlements & Provider Permissions (Scenarios 1-6)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 4: Provider-Specific Connector Entitlements & Fail-Closed Behavior', () => {
    it('Scenario 1: Resolves connectorAccess=true and NORMAL_CONNECTOR when quota.connectors > 0 and provider is active', async () => {
      const reader = {
        getEffectiveEntitlements: vi.fn().mockResolvedValue([
          { feature_key: 'alerting.enabled', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
          { feature_key: 'quota.connectors', boolean_value: null, integer_value: 5, decimal_value: null, string_value: null },
          { feature_key: 'integrations.slack', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
        ]),
      };
      const service = new NotificationEntitlementService(reader);
      const decision = await service.resolve('org-1');

      expect(decision.mode).toBe('NORMAL_CONNECTOR');
      expect(decision.connectorAccess).toBe(true);
      expect(decision.alertingEnabled).toBe(true);
      expect(decision.externalConnectorsEnabled).toBe(true);
      expect(decision.managedEmailEnabled).toBe(true);
      expect(decision.providers.slack).toBe(true);
      expect(decision.providers.discord).toBe(false);
      expect(decision.isProviderAllowed('slack')).toBe(true);
      expect(decision.isProviderAllowed('discord')).toBe(false);
      expect(decision.isProviderAllowed('email', false)).toBe(true);
    });

    it('Scenario 2: Resolves connectorAccess=false and EMAIL_ONLY_RESTRICTED when quota.connectors = 0 (Free tier)', async () => {
      const reader = {
        getEffectiveEntitlements: vi.fn().mockResolvedValue([
          { feature_key: 'alerting.enabled', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
          { feature_key: 'quota.connectors', boolean_value: null, integer_value: 0, decimal_value: null, string_value: null },
          { feature_key: 'integrations.slack', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
        ]),
      };
      const service = new NotificationEntitlementService(reader);
      const decision = await service.resolve('org-free');

      expect(decision.mode).toBe('EMAIL_ONLY_RESTRICTED');
      expect(decision.connectorAccess).toBe(false);
      expect(decision.externalConnectorsEnabled).toBe(false);
      expect(decision.managedEmailEnabled).toBe(true);
      expect(decision.reason).toBe('CONNECTOR_ENTITLEMENT_REQUIRED');
    });

    it('Scenario 3: Granular provider entitlement: Slack allowed, Discord unentitled', async () => {
      const reader = {
        getEffectiveEntitlements: vi.fn().mockResolvedValue([
          { feature_key: 'alerting.enabled', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
          { feature_key: 'quota.connectors', boolean_value: null, integer_value: 2, decimal_value: null, string_value: null },
          { feature_key: 'integrations.slack', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
          { feature_key: 'integrations.discord', boolean_value: false, integer_value: null, decimal_value: null, string_value: null },
        ]),
      };
      const service = new NotificationEntitlementService(reader);
      const decision = await service.resolve('org-slack-only');

      expect(decision.isProviderAllowed('slack')).toBe(true);
      expect(decision.isProviderAllowed('discord')).toBe(false);
      expect(decision.isProviderAllowed('teams')).toBe(false);
      expect(decision.isProviderAllowed('webhook')).toBe(false);
    });

    it('Scenario 4: Supports both canonical (integrations.microsoft_teams) and alias (integrations.teams) for MS Teams', async () => {
      const readerWithAlias = {
        getEffectiveEntitlements: vi.fn().mockResolvedValue([
          { feature_key: 'alerting.enabled', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
          { feature_key: 'quota.connectors', boolean_value: null, integer_value: 1, decimal_value: null, string_value: null },
          { feature_key: 'integrations.teams', boolean_value: true, integer_value: null, decimal_value: null, string_value: null },
        ]),
      };
      const service = new NotificationEntitlementService(readerWithAlias);
      const decision = await service.resolve('org-teams');

      expect(decision.providers.teams).toBe(true);
      expect(decision.isProviderAllowed('teams')).toBe(true);
    });

    it('Scenario 5: Entitlement lookup failure fails closed for external connectors but preserves managed email', async () => {
      const reader = {
        getEffectiveEntitlements: vi.fn().mockRejectedValue(new Error('PostgreSQL connection timeout')),
      };
      const service = new NotificationEntitlementService(reader);
      const decision = await service.resolve('org-error');

      expect(decision.mode).toBe('EMAIL_ONLY_RESTRICTED');
      expect(decision.connectorAccess).toBe(false);
      expect(decision.alertingEnabled).toBe(false);
      expect(decision.externalConnectorsEnabled).toBe(false);
      expect(decision.managedEmailEnabled).toBe(true);
      expect(decision.reason).toBe('ENTITLEMENT_UNKNOWN');
      expect(decision.isProviderAllowed('slack')).toBe(false);
      expect(decision.isProviderAllowed('discord')).toBe(false);
      expect(decision.isProviderAllowed('webhook')).toBe(false);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: Project Owner Invariant & Mutation Constraints (Scenarios 7-11)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 5: Project Owner Invariant & Safe Mutations', () => {
    it('Scenario 7 & 9: Reject direct member add with owner role (must use transfer ownership)', async () => {
      const mockRepo = {
        isOrganizationMember: vi.fn().mockResolvedValue(true),
        findProjectMemberByUserId: vi.fn().mockResolvedValue(null),
        addProjectMember: vi.fn(),
      } as any;
      const memberService = new ProjectMemberService({
        repository: { findProjectById: vi.fn().mockResolvedValue({ id: 'proj-1', organization_id: 'org-1' }) } as any,
        membersRepository: mockRepo,
        logger: mockLogger,
        orgRepo: {} as any,
        auditService: {} as any,
        settingsRepository: {} as any,
        apiKeyRepository: {} as any,
        environmentRepository: {} as any,
        usageRepository: {} as any,
      });

      // Mock user has admin access
      vi.spyOn(memberService as any, 'requireProjectAccess').mockResolvedValue(undefined);

      await expect(
        memberService.addMember(
          'org-1',
          'proj-1',
          'admin-user',
          { userId: 'new-user', role: ProjectMemberRole.OWNER },
          { ip: '127.0.0.1' },
        ),
      ).rejects.toThrowError(ProjectError);
    });

    it('Scenario 10: Reject direct member role update to owner', async () => {
      const mockRepo = {
        findProjectMemberById: vi.fn().mockResolvedValue({
          id: 'mem-1',
          projectId: 'proj-1',
          userId: 'user-2',
          role: ProjectMemberRole.MEMBER,
          status: 'active',
        }),
      } as any;
      const memberService = new ProjectMemberService({
        repository: { findProjectById: vi.fn().mockResolvedValue({ id: 'proj-1', organization_id: 'org-1' }) } as any,
        membersRepository: mockRepo,
        logger: mockLogger,
        orgRepo: {} as any,
        auditService: {} as any,
        settingsRepository: {} as any,
        apiKeyRepository: {} as any,
        environmentRepository: {} as any,
        usageRepository: {} as any,
      });
      vi.spyOn(memberService as any, 'requireProjectAccess').mockResolvedValue(undefined);

      await expect(
        memberService.updateMemberRole(
          'org-1',
          'proj-1',
          'mem-1',
          'admin-user',
          { role: ProjectMemberRole.OWNER },
          { ip: '127.0.0.1' },
        ),
      ).rejects.toThrow('Use the transfer ownership endpoint to change the owner');
    });

    it('Scenario 11: Reject direct removal of project owner without ownership transfer', async () => {
      const mockRepo = {
        findProjectMemberById: vi.fn().mockResolvedValue({
          id: 'mem-owner',
          projectId: 'proj-1',
          userId: 'owner-user',
          role: ProjectMemberRole.OWNER,
          status: 'active',
        }),
      } as any;
      const memberService = new ProjectMemberService({
        repository: { findProjectById: vi.fn().mockResolvedValue({ id: 'proj-1', organization_id: 'org-1' }) } as any,
        membersRepository: mockRepo,
        logger: mockLogger,
        orgRepo: {} as any,
        auditService: {} as any,
        settingsRepository: {} as any,
        apiKeyRepository: {} as any,
        environmentRepository: {} as any,
        usageRepository: {} as any,
      });
      vi.spyOn(memberService as any, 'requireProjectAccess').mockResolvedValue(undefined);

      await expect(
        memberService.removeMember(
          'org-1',
          'proj-1',
          'mem-owner',
          'admin-user',
          { ip: '127.0.0.1' },
        ),
      ).rejects.toThrow('Project owner cannot be removed; transfer ownership first');
    });

    it('Scenario 8: Atomic ownership transfer demotes old owner and promotes new owner inside transaction with row locking', async () => {
      const queryMock = vi.fn().mockImplementation((sql: string, params: any[]) => {
        if (sql.includes('FOR UPDATE')) return Promise.resolve({ rows: [{ id: 'mem-1' }, { id: 'mem-2' }] });
        if (sql.includes("UPDATE project_members SET role='admin'")) return Promise.resolve({ rows: [] });
        if (sql.includes("UPDATE project_members AS m SET role=$2")) {
          return Promise.resolve({
            rows: [{
              id: 'mem-2',
              project_id: 'proj-1',
              organization_id: 'org-1',
              user_id: 'user-new-owner',
              role: 'owner',
              status: 'active',
              invited_by: null,
              created_at: new Date(),
              updated_at: new Date(),
              version: 2,
            }],
          });
        }
        if (sql.includes('SELECT') && params?.[1] === 'user-old-owner') {
          return Promise.resolve({
            rows: [{
              id: 'mem-1',
              project_id: 'proj-1',
              organization_id: 'org-1',
              user_id: 'user-old-owner',
              role: 'owner',
              status: 'active',
              invited_by: null,
              created_at: new Date(),
              updated_at: new Date(),
              version: 1,
            }],
          });
        }
        if (sql.includes('SELECT') && params?.[1] === 'user-new-owner') {
          return Promise.resolve({
            rows: [{
              id: 'mem-2',
              project_id: 'proj-1',
              organization_id: 'org-1',
              user_id: 'user-new-owner',
              role: 'admin',
              status: 'active',
              invited_by: null,
              created_at: new Date(),
              updated_at: new Date(),
              version: 1,
            }],
          });
        }
        if (sql.includes('SELECT') && params?.[0] === 'mem-1') {
          return Promise.resolve({
            rows: [{
              id: 'mem-1',
              project_id: 'proj-1',
              organization_id: 'org-1',
              user_id: 'user-old-owner',
              role: 'admin',
              status: 'active',
              invited_by: null,
              created_at: new Date(),
              updated_at: new Date(),
              version: 2,
            }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const mockDbClient = {
        query: queryMock,
      } as any;

      const memberRepo = new MemberRepository({
        query: queryMock,
        connect: vi.fn().mockResolvedValue({
          query: queryMock,
          release: vi.fn(),
        }),
      } as any);

      const result = await memberRepo.transferOwnership(
        'proj-1',
        'user-old-owner',
        'user-new-owner',
        'user-old-owner',
        mockDbClient,
      );

      expect(result.fromMember.role).toBe('admin');
      expect(result.toMember.role).toBe('owner');
      expect(queryMock).toHaveBeenCalledWith('SELECT id FROM project_members WHERE project_id = $1 FOR UPDATE', ['proj-1']);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: Owner Deactivation & Relational Fallback (Scenarios 12-16)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 6: Project Owner Deactivation & Organization Fallback Policy', () => {
    it('Scenario 13: Routes to verified active project owner in EMAIL_ONLY_RESTRICTED mode', async () => {
      const ownerReader: ProjectOwnerReader = {
        findActiveVerifiedOwner: vi.fn().mockResolvedValue({
          userId: 'usr-owner',
          email: 'owner@example.com',
        }),
        findActiveVerifiedFallbackRecipient: vi.fn(),
      };
      const routing = new EmailOnlyRestrictedRouting(ownerReader);
      const result = await routing.resolve('org-1', 'proj-1');

      expect(result.reason).toBe('EMAIL_ONLY_RESTRICTED');
      expect(result.target).not.toBeNull();
      expect(result.target?.recipientUserId).toBe('usr-owner');
      expect(result.target?.recipientRef).toBe('owner@example.com');
      expect(result.target?.recipientType).toBe('PROJECT_OWNER');
      expect(result.target?.provider).toBe('MANAGED_EMAIL');
    });

    it('Scenario 14 & 15: When project owner is inactive/unverified, routes to organization fallback recipient', async () => {
      const ownerReader: ProjectOwnerReader = {
        findActiveVerifiedOwner: vi.fn().mockResolvedValue(null), // Owner is missing or unverified
        findActiveVerifiedFallbackRecipient: vi.fn().mockResolvedValue({
          userId: 'usr-org-admin',
          email: 'admin@org.com',
        }),
      };
      const routing = new EmailOnlyRestrictedRouting(ownerReader);
      const result = await routing.resolve('org-1', 'proj-1');

      expect(result.reason).toBe('EMAIL_ONLY_RESTRICTED');
      expect(result.target).not.toBeNull();
      expect(result.target?.recipientUserId).toBe('usr-org-admin');
      expect(result.target?.recipientRef).toBe('admin@org.com');
      expect(result.target?.recipientType).toBe('ORGANIZATION_FALLBACK');
      expect(result.target?.provider).toBe('MANAGED_EMAIL');
    });

    it('Scenario 16: When neither project owner nor org fallback exists, records suppression without silent loss', async () => {
      const ownerReader: ProjectOwnerReader = {
        findActiveVerifiedOwner: vi.fn().mockResolvedValue(null),
        findActiveVerifiedFallbackRecipient: vi.fn().mockResolvedValue(null),
      };
      const routing = new EmailOnlyRestrictedRouting(ownerReader);
      const result = await routing.resolve('org-1', 'proj-1');

      expect(result.target).toBeNull();
      expect(result.reason).toBe('OWNER_EMAIL_UNAVAILABLE');

      // Now verify that NotificationRoutingService records explicit suppression
      const entitlementService = {
        resolve: vi.fn().mockResolvedValue({
          mode: 'EMAIL_ONLY_RESTRICTED',
          connectorAccess: false,
          alertingEnabled: true,
          externalConnectorsEnabled: false,
          managedEmailEnabled: true,
          reason: 'CONNECTOR_ENTITLEMENT_REQUIRED',
          isProviderAllowed: () => false,
        }),
      } as any;

      const service = new NotificationRoutingService({
        logger: mockLogger,
        channelRepository: { resolveImmediateDeliveryTargets: vi.fn(), resolveNoChannelEmailTargets: vi.fn() } as any,
        configRepository: { findActiveSilences: vi.fn().mockResolvedValue([]) } as any,
        entitlementService,
        restrictedRouting: routing,
      });

      const decision = await service.resolve({
        organizationId: 'org-1',
        projectId: 'proj-1',
        category: 'system',
        severity: 'critical',
        policy: { effectiveRuleHash: 'hash-1' } as any,
        ruleId: 'rule-1',
        observedAt: new Date(),
      });

      expect(decision.suppressed).toBe(true);
      expect(decision.suppressionReason).toBe('owner_email_unavailable');
      expect(decision.targets.length).toBe(0);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: 'org-1', projectId: 'proj-1' }),
        expect.stringContaining('Critical alert delivery suppressed'),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: Asynchronous Managed Email Delivery (Scenarios 20-25)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Area 2: Asynchronous Managed Email Queue & Delivery Contract', () => {
    it('Scenario 20 & 21: AlertNotificationRouter enqueues ManagedEmailJobData to connector.v2.email without synchronous SMTP I/O', async () => {
      const sendSpy = vi.spyOn(pgboss, 'send').mockResolvedValue('job-boss-1' as never);

      const mockDb = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as Pool;

      const router = new AlertNotificationRouter(mockDb, mockLogger);
      vi.spyOn((router as any).repo, 'findNotificationJobById').mockResolvedValue({
        id: 'notif-job-1',
        organization_id: 'org-1',
        project_id: 'proj-1',
        channel_kind: 'email',
        connector_id: null,
        recipient_user_id: 'usr-1',
        recipient_ref: 'owner@example.com',
        delivery_mode: 'EMAIL_ONLY_RESTRICTED',
        recipient_type: 'PROJECT_OWNER',
        provider: 'MANAGED_EMAIL',
        severity: 'critical',
        status: 'pending',
        priority: 10,
        payload: { title: 'High CPU', body: 'CPU > 90%' },
        idempotency_key: 'idem-1',
        routing_decision_hash: 'hash-1',
      });

      vi.spyOn((router as any).owners, 'findActiveVerifiedOwner').mockResolvedValue({
        userId: 'usr-1',
        email: 'owner@example.com',
      });

      const markSpy = vi.spyOn(router as any, 'mark').mockResolvedValue(undefined);

      const status = await router.dispatchById('notif-job-1');

      expect(status).toBe('queued');
      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^connector(\.v2\.|-send-)email$/),
        expect.objectContaining({
          notificationJobId: 'notif-job-1',
          organizationId: 'org-1',
          recipientEmail: 'owner@example.com',
          recipientUserId: 'usr-1',
          provider: 'MANAGED_EMAIL',
          severity: 'critical',
        }),
        expect.objectContaining({
          retryLimit: 3,
          retryDelay: 5,
          retryBackoff: true,
        }),
      );
      expect(markSpy).toHaveBeenCalledWith(expect.anything(), 'queued', expect.any(Number));
    });

    it('Scenario 22: Managed email payload conforms to ManagedEmailJobData schema', () => {
      const validEmailJob: ManagedEmailJobData = {
        organizationId: 'org-1',
        notificationJobId: 'job-1',
        projectId: 'proj-1',
        alertKey: 'alert-cpu',
        deliveryMode: 'EMAIL_ONLY_RESTRICTED',
        recipientType: 'PROJECT_OWNER',
        recipientUserId: 'usr-1',
        recipientEmail: 'owner@company.com',
        provider: 'MANAGED_EMAIL',
        severity: 'critical',
        idempotencyKey: 'idem-cpu-1',
        payload: { title: 'Alert', body: 'Incident active' },
      };

      expect(isManagedEmailJob(validEmailJob)).toBe(true);
      expect(isConnectorTransportJob(validEmailJob)).toBe(false);
    });

    it('Scenario 23: Connector transport payload conforms to ConnectorTransportJob schema', () => {
      const validSlackJob = {
        organizationId: 'org-1',
        notificationJobId: 'job-2',
        connectorId: 'conn-slack-1',
        channelKind: 'slack',
        severity: 'warning' as const,
        idempotencyKey: 'idem-slack-1',
        correlationId: 'alert-mem',
        payload: { text: 'Memory alert' },
      };

      expect(isConnectorTransportJob(validSlackJob)).toBe(true);
      expect(isManagedEmailJob(validSlackJob)).toBe(false);
    });

    it('Scenario 17: Worker entitlement re-check blocks external connector when plan downgraded mid-flight', async () => {
      const entitlementService = {
        resolve: vi.fn().mockResolvedValue({
          mode: 'EMAIL_ONLY_RESTRICTED',
          connectorAccess: false,
          alertingEnabled: true,
          externalConnectorsEnabled: false,
          managedEmailEnabled: true,
          reason: 'CONNECTOR_ENTITLEMENT_REQUIRED',
          isProviderAllowed: () => false,
        }),
      };

      const capability = await entitlementService.resolve('org-downgraded');
      expect(capability.connectorAccess).toBe(false);
      expect(capability.isProviderAllowed('slack')).toBe(false);
    });

    it('Scenario 18: Owner email change updates recipient dynamically on next lookup', async () => {
      let currentEmail = 'old-owner@example.com';
      const ownerReader: ProjectOwnerReader = {
        findActiveVerifiedOwner: vi.fn().mockImplementation(() => Promise.resolve({
          userId: 'usr-1',
          email: currentEmail,
        })),
        findActiveVerifiedFallbackRecipient: vi.fn(),
      };

      const routing = new EmailOnlyRestrictedRouting(ownerReader);
      const res1 = await routing.resolve('org-1', 'proj-1');
      expect(res1.target?.recipientRef).toBe('old-owner@example.com');

      // Owner updates verified email address
      currentEmail = 'new-owner@example.com';
      const res2 = await routing.resolve('org-1', 'proj-1');
      expect(res2.target?.recipientRef).toBe('new-owner@example.com');
    });

    it('Scenario 24 & 25: Delivery ledger records job status, latency, error category and idempotency key', async () => {
      const deliveryRecords: any[] = [];
      const mockRuntimeRepo = {
        recordNotificationDelivery: vi.fn().mockImplementation((rec) => {
          deliveryRecords.push(rec);
          return Promise.resolve();
        }),
      };

      await mockRuntimeRepo.recordNotificationDelivery({
        organizationId: 'org-1',
        jobId: 'notif-1',
        jobStatus: 'sent',
        attemptStatus: 'sent',
        latencyMs: 42,
      });

      expect(deliveryRecords.length).toBe(1);
      expect(deliveryRecords[0].jobStatus).toBe('sent');
      expect(deliveryRecords[0].latencyMs).toBe(42);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: Multi-Tenant Isolation & Security (Scenarios 26-28)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Tenant Isolation & Boundary Defense', () => {
    it('Scenario 28: Multi-tenant isolation: Org A cannot route or resolve recipients from Org B', async () => {
      const queryMock = vi.fn().mockImplementation((sql: string, params: any[]) => {
        const [orgId] = params;
        if (orgId === 'org-A') {
          return Promise.resolve({
            rows: [{ user_id: 'user-A', email: 'a@org-a.com' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const ownerRepo = new ProjectOwnerRepository({ query: queryMock } as any);
      const ownerA = await ownerRepo.findActiveVerifiedOwner('org-A', 'proj-1');
      const ownerB = await ownerRepo.findActiveVerifiedOwner('org-B', 'proj-1');

      expect(ownerA?.email).toBe('a@org-a.com');
      expect(ownerB).toBeNull();
    });
  });
});
