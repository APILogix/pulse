import { pool } from '../../../config/database.js';
import type { Pool } from 'pg';
import { entitlementsService, type EntitlementsMap, type EntitlementsService } from '../../billing/entitlements/service.js';
import { usageService, type UsageService } from '../../billing/usage/service.js';

export interface BootstrapUserContext {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface BootstrapResponseData {
  currentOrganizationId: string | null;
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
    isCurrent: boolean;
  }>;
  projects: Array<{
    id: string;
    name: string;
    slug: string;
    status: string;
  }>;
  billing: {
    plan: {
      id: string;
      key: string;
      name: string;
    };
    status: string;
    currentPeriodEnd: string | null;
    cancelAtPeriodEnd: boolean;
  } | null;
  features: Record<string, boolean>;
  integrations: Record<string, boolean>;
  quotas: Record<string, {
    limit: number;
    used: number;
    remaining: number;
  }>;
  usage: {
    monthlyEvents: {
      limit: number;
      used: number;
      remaining: number;
      percentage: number;
    };
    aiCredits: {
      limit: number;
      used: number;
      remaining: number;
      percentage: number;
    };
  };
}

export class BootstrapService {
  constructor(
    private readonly db: Pool = pool,
    private readonly entitlements: EntitlementsService = entitlementsService,
    private readonly usage: UsageService = usageService,
  ) {}

  private async fetchQuotaUsageCounts(orgId: string): Promise<Record<string, number>> {
    try {
      const res = await this.db.query<{
        projects_used: number;
        members_used: number;
        environments_used: number;
        api_keys_used: number;
        connectors_used: number;
        alert_rules_used: number;
        project_alert_rules_used: number;
        alert_channels_used: number;
        routing_rules_used: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM projects WHERE org_id = $1 AND deleted_at IS NULL)::int AS projects_used,
           (SELECT COUNT(*) FROM organization_members WHERE org_id = $1 AND status = 'active')::int AS members_used,
           (SELECT COUNT(*) FROM project_environments WHERE organization_id = $1 AND type = 'custom'::project_environment_type AND deleted_at IS NULL)::int AS environments_used,
           (SELECT COUNT(*) FROM project_api_keys WHERE organization_id = $1 AND status = 'active' AND deleted_at IS NULL)::int AS api_keys_used,
           (SELECT COUNT(*) FROM connector_configs WHERE organization_id = $1 AND is_active = true AND deleted_at IS NULL)::int AS connectors_used,
           (SELECT COUNT(*) FROM alert_rules WHERE organization_id = $1 AND deleted_at IS NULL)::int AS alert_rules_used,
           COALESCE((SELECT MAX(rule_count) FROM (SELECT COUNT(*) AS rule_count FROM alert_rules WHERE organization_id = $1 AND project_id IS NOT NULL AND deleted_at IS NULL GROUP BY project_id) t), 0)::int AS project_alert_rules_used,
           (SELECT COUNT(*) FROM project_alert_channels WHERE organization_id = $1 AND deleted_at IS NULL)::int AS alert_channels_used,
           (SELECT COUNT(*) FROM alert_routing_rules WHERE organization_id = $1 AND deleted_at IS NULL)::int AS routing_rules_used`,
        [orgId]
      );
      const row = res.rows[0];
      return {
        projects: row?.projects_used ?? 0,
        members: row?.members_used ?? 0,
        environments: row?.environments_used ?? 0,
        apiKeys: row?.api_keys_used ?? 0,
        connectors: row?.connectors_used ?? 0,
        alertRules: row?.alert_rules_used ?? 0,
        projectAlertRules: row?.project_alert_rules_used ?? 0,
        alertChannels: row?.alert_channels_used ?? 0,
        routingRules: row?.routing_rules_used ?? 0,
      };
    } catch {
      return {
        projects: 0,
        members: 0,
        environments: 0,
        apiKeys: 0,
        connectors: 0,
        alertRules: 0,
        projectAlertRules: 0,
        alertChannels: 0,
        routingRules: 0,
      };
    }
  }

  private emptyUsage() {
    return {
      success: true,
      data: {
        eventsUsed: 0,
        eventLimit: 0,
        remainingEvents: 0,
        aiCreditsUsed: 0,
        aiCreditLimit: 0,
        remainingAiCredits: 0,
        projectsUsed: 0,
        membersUsed: 0,
      },
    };
  }

  async getBootstrapContext(
    user: BootstrapUserContext,
    preferredOrgId?: string | null
  ): Promise<BootstrapResponseData> {
    // 1. Fetch user's active organizations
    const orgsResult = await this.db.query<{
      id: string;
      name: string;
      slug: string;
      role: string;
    }>(
      `SELECT o.id, o.name, o.slug, om.role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.id
       WHERE om.user_id = $1 AND om.status = 'active' AND o.deleted_at IS NULL
       ORDER BY o.name ASC`,
      [user.id]
    );
    const orgs = orgsResult.rows;

    let currentOrg = orgs.find((o) => o.id === preferredOrgId) ?? orgs[0] ?? null;

    if (!currentOrg) {
      return {
        currentOrganizationId: null,
        organizations: [],
        projects: [],
        billing: null,
        features: {},
        integrations: {
          slack: false,
          discord: false,
          microsoftTeams: false,
          pagerduty: false,
          webhook: false,
          email: false,
          sms: false,
        },
        quotas: {
          projects: { limit: 0, used: 0, remaining: 0 },
          members: { limit: 0, used: 0, remaining: 0 },
          environments: { limit: 0, used: 0, remaining: 0 },
          apiKeys: { limit: 0, used: 0, remaining: 0 },
          connectors: { limit: 0, used: 0, remaining: 0 },
          alertRules: { limit: 0, used: 0, remaining: 0 },
          projectAlertRules: { limit: 0, used: 0, remaining: 0 },
          alertChannels: { limit: 0, used: 0, remaining: 0 },
          routingRules: { limit: 0, used: 0, remaining: 0 },
        },
        usage: {
          monthlyEvents: { limit: 0, used: 0, remaining: 0, percentage: 0 },
          aiCredits: { limit: 0, used: 0, remaining: 0, percentage: 0 },
        },
      };
    }

    const orgId = currentOrg.id;

    // 2. Fetch projects for current organization & billing context in parallel
    const [projectsResult, sub, allEntitlements, currentUsage, usageCounts] = await Promise.all([
      this.db.query<{
        id: string;
        name: string;
        slug: string;
        status: string;
      }>(
        `SELECT id, name, slug, status
         FROM projects
         WHERE org_id = $1 AND deleted_at IS NULL
        ORDER BY name ASC`,
        [orgId]
      ),
      this.entitlements.getSubscriptionState(orgId).catch(() => null),
      this.entitlements.getEffectiveEntitlements(orgId).catch((): EntitlementsMap => ({})),
      this.usage.getCurrentUsage(orgId).catch(() => this.emptyUsage()),
      this.fetchQuotaUsageCounts(orgId),
    ]);

    const capitalize = (str: string) => (str ? str.charAt(0).toUpperCase() + str.slice(1) : '');

    const billing = sub
      ? {
          plan: {
            id: sub.planId,
            key: sub.planKey,
            name: capitalize(sub.planKey),
          },
          status: sub.status,
          currentPeriodEnd: sub.currentPeriodEnd ? sub.currentPeriodEnd.toISOString() : null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
        }
      : null;

    // Map features to API field names
    const featureKeyMap: Record<string, string> = {
      'ai.enabled': 'ai',
      'alerting.enabled': 'alerting',
      'tracing.enabled': 'tracing',
      'error_tracking.enabled': 'errorTracking',
      'metrics.enabled': 'metrics',
      'logging.enabled': 'logging',
      'profiling.enabled': 'profiling',
      'uptime.enabled': 'uptime',
      'replay.enabled': 'sessionReplay',
      'dashboards.enabled': 'dashboards',
      'security.enabled': 'security',
      'sdk.enabled': 'sdk',
    };

    const features: Record<string, boolean> = {};
    for (const [dbKey, apiKey] of Object.entries(featureKeyMap)) {
      features[apiKey] = allEntitlements[dbKey]?.booleanValue === true;
    }
    for (const [key, ent] of Object.entries(allEntitlements)) {
      if (ent.booleanValue !== null && !key.startsWith('quota.') && !key.startsWith('integrations.')) {
        const apiKey = featureKeyMap[key] ?? key;
        features[apiKey] = ent.booleanValue === true;
      }
    }

    // Map 7 supported integrations
    const integrations: Record<string, boolean> = {
      slack: allEntitlements['integrations.slack']?.booleanValue === true,
      discord: allEntitlements['integrations.discord']?.booleanValue === true,
      microsoftTeams: allEntitlements['integrations.microsoft_teams']?.booleanValue === true,
      pagerduty: allEntitlements['integrations.pagerduty']?.booleanValue === true,
      webhook: allEntitlements['integrations.webhook']?.booleanValue === true,
      email: allEntitlements['integrations.email']?.booleanValue === true,
      sms: allEntitlements['integrations.sms']?.booleanValue === true,
    };

    // Map 9 canonical quotas
    const quotaKeysMapping: Array<{ apiField: string; dbKey: string }> = [
      { apiField: 'projects', dbKey: 'quota.projects' },
      { apiField: 'members', dbKey: 'quota.members' },
      { apiField: 'environments', dbKey: 'quota.environments' },
      { apiField: 'apiKeys', dbKey: 'quota.api_keys' },
      { apiField: 'connectors', dbKey: 'quota.connectors' },
      { apiField: 'alertRules', dbKey: 'quota.alert_rules' },
      { apiField: 'projectAlertRules', dbKey: 'quota.project_alert_rules' },
      { apiField: 'alertChannels', dbKey: 'quota.alert_channels' },
      { apiField: 'routingRules', dbKey: 'quota.routing_rules' },
    ];

    const quotas: Record<string, { limit: number; used: number; remaining: number }> = {};
    for (const { apiField, dbKey } of quotaKeysMapping) {
      const ent = allEntitlements[dbKey];
      const limit = ent?.integerValue ?? 0;
      const used = usageCounts[apiField] ?? 0;
      const remaining = limit === -1 ? -1 : Math.max(0, limit - used);

      quotas[apiField] = { limit, used, remaining };
    }

    // Map usage
    const usageData = currentUsage.data;
    const eventsLimit = usageData.eventLimit;
    const eventsUsed = usageData.eventsUsed;
    const eventsRemaining = eventsLimit < 0 ? -1 : Math.max(0, usageData.remainingEvents);
    const eventsPct = eventsLimit > 0 ? Math.min(100, Math.round((eventsUsed / eventsLimit) * 100)) : 0;

    const aiLimit = usageData.aiCreditLimit;
    const aiUsed = usageData.aiCreditsUsed;
    const aiRemaining = aiLimit < 0 ? -1 : Math.max(0, usageData.remainingAiCredits);
    const aiPct = aiLimit > 0 ? Math.min(100, Math.round((aiUsed / aiLimit) * 100)) : 0;

    const usage = {
      monthlyEvents: {
        limit: eventsLimit,
        used: eventsUsed,
        remaining: eventsRemaining,
        percentage: eventsPct,
      },
      aiCredits: {
        limit: aiLimit,
        used: aiUsed,
        remaining: aiRemaining,
        percentage: aiPct,
      },
    };

    return {
      currentOrganizationId: orgId,
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        role: o.role,
        isCurrent: o.id === orgId,
      })),
      projects: projectsResult.rows,
      billing,
      features,
      integrations,
      quotas,
      usage,
    };
  }
}

export const bootstrapService = new BootstrapService();
