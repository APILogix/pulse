import { UsageRepository } from './repository.js';
import { CurrentUsageResponseSchema, QuotaSummaryResponseSchema } from './schemas.js';
import { BillingError, BillingErrorCodes } from '../shared/errors.js';
import { entitlementsService, type EntitlementsService } from '../entitlements/service.js';

const POSTGRES_BIGINT_MAX = '9223372036854775807';

interface BillingUserContext {
  id: string;
  currentOrgId?: string | null;
  orgId?: string | null;
}

function toUsageNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (String(value) === POSTGRES_BIGINT_MAX) return -1;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export class UsageService {
  constructor(
    private readonly repository: UsageRepository = new UsageRepository(),
    private readonly entitlements: EntitlementsService = entitlementsService,
  ) {}

  async resolveAuthorizedOrgId(user: BillingUserContext | undefined, requestedOrgId?: string): Promise<string> {
    if (!user?.id) {
      throw new BillingError('Authentication required', BillingErrorCodes.UNAUTHORIZED, 401);
    }

    const orgId = requestedOrgId ?? user.currentOrgId ?? user.orgId ?? null;
    if (!orgId) {
      throw new BillingError('No organization context', BillingErrorCodes.UNAUTHORIZED, 403);
    }

    if (requestedOrgId && !(await this.repository.isActiveOrganizationMember(requestedOrgId, user.id))) {
      throw new BillingError('User is not a member of the requested organization', BillingErrorCodes.UNAUTHORIZED, 403);
    }

    return orgId;
  }

  async getCurrentUsage(orgId: string) {
    const usage = await this.repository.getCurrentUsage(orgId);
    if (!usage) {
      // Return zeros if no usage row exists yet (might happen right after org creation before sub is set)
      return CurrentUsageResponseSchema.parse({
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
        }
      });
    }

    const eventsUsed = toUsageNumber(usage.events_used);
    const eventLimit = toUsageNumber(usage.event_limit);
    const aiCreditsUsed = toUsageNumber(usage.ai_credits_used);
    const aiCreditLimit = toUsageNumber(usage.ai_credit_limit);

    return CurrentUsageResponseSchema.parse({
      success: true,
      data: {
        eventsUsed,
        eventLimit,
        remainingEvents: eventLimit < 0 ? -1 : Math.max(0, toUsageNumber(usage.remaining_events)),
        aiCreditsUsed,
        aiCreditLimit,
        remainingAiCredits: aiCreditLimit < 0 ? -1 : Math.max(0, toUsageNumber(usage.remaining_ai_credits)),
        projectsUsed: toUsageNumber(usage.projects_used),
        membersUsed: toUsageNumber(usage.members_used),
      }
    });
  }

  async incrementEventUsage(orgId: string, count: number = 1) {
    await this.repository.incrementEventUsage(orgId, count);
    return { success: true };
  }

  async incrementUsage(orgId: string, metric: 'events' | 'ai_credits' | string, count: number = 1) {
    if (metric === 'events') {
      await this.repository.incrementEventUsage(orgId, count);
    }
    return { success: true };
  }

  async reserveUsage(_orgId: string, _metric: string, _count: number): Promise<{ reservationId: string }> {
    return { reservationId: `res_${Date.now()}` };
  }

  async consumeUsage(orgId: string, metric: string, count: number = 1): Promise<{ success: boolean }> {
    return this.incrementUsage(orgId, metric, count);
  }

  async releaseUsage(_orgId: string, _metric: string, _count: number): Promise<{ success: boolean }> {
    return { success: true };
  }

  async getRemaining(orgId: string, metric: 'monthly_events' | 'ai_credits' | string): Promise<number> {
    const usage = await this.repository.getCurrentUsage(orgId);
    if (!usage) return 0;
    if (metric === 'monthly_events' || metric === 'quota.monthly_events') {
      const limit = toUsageNumber(usage.event_limit);
      if (limit < 0) return -1;
      return Math.max(0, toUsageNumber(usage.remaining_events));
    }
    if (metric === 'ai_credits' || metric === 'quota.ai_credits') {
      const limit = toUsageNumber(usage.ai_credit_limit);
      if (limit < 0) return -1;
      return Math.max(0, toUsageNumber(usage.remaining_ai_credits));
    }
    return 0;
  }

  async getPercentage(orgId: string, metric: 'monthly_events' | 'ai_credits' | string): Promise<number> {
    const usage = await this.repository.getCurrentUsage(orgId);
    if (!usage) return 0;
    if (metric === 'monthly_events' || metric === 'quota.monthly_events') {
      const limit = toUsageNumber(usage.event_limit);
      if (limit <= 0) return 0;
      const used = toUsageNumber(usage.events_used);
      return Math.min(100, Math.round((used / limit) * 100));
    }
    if (metric === 'ai_credits' || metric === 'quota.ai_credits') {
      const limit = toUsageNumber(usage.ai_credit_limit);
      if (limit <= 0) return 0;
      const used = toUsageNumber(usage.ai_credits_used);
      return Math.min(100, Math.round((used / limit) * 100));
    }
    return 0;
  }

  async getQuotaSummary(orgId: string) {
    const usage = await this.repository.getCurrentUsage(orgId);
    if (!usage) {
      const now = new Date();
      const endOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59, 999));
      return QuotaSummaryResponseSchema.parse({
        success: true,
        data: {
          eventsLeft: 0,
          totalEvents: 0,
          billingCycleEndDate: endOfMonth.toISOString(),
          aiCreditsTotal: 0,
          aiCreditsLeft: 0,
        }
      });
    }

    const totalEvents = toUsageNumber(usage.event_limit);
    const aiCreditsTotal = toUsageNumber(usage.ai_credit_limit);

    return QuotaSummaryResponseSchema.parse({
      success: true,
      data: {
        eventsLeft: totalEvents < 0 ? -1 : Math.max(0, toUsageNumber(usage.remaining_events)),
        totalEvents,
        billingCycleEndDate: usage.period_end.toISOString(),
        aiCreditsTotal,
        aiCreditsLeft: aiCreditsTotal < 0 ? -1 : Math.max(0, toUsageNumber(usage.remaining_ai_credits)),
      }
    });
  }

  async getDailyUsage(orgId: string, startDate?: Date, endDate?: Date) {
    const records = await this.repository.getDailyUsageRecords(orgId, startDate, endDate);
    return {
      success: true,
      data: records.map(r => ({
        date: r.usage_date,
        eventsCount: r.events_count,
        aiCreditsUsed: r.ai_credits_used,
        errorsCount: r.errors_count,
        requestsCount: r.requests_count
      }))
    };
  }

  async getProjectAttribution(
    orgId: string,
    options: { bucket: 'minute' | 'hour' | 'day'; startDate?: Date; endDate?: Date; projectId?: string; limit: number; offset: number }
  ) {
    const records = await this.repository.getProjectAttribution(orgId, options);
    return { success: true, data: records };
  }

  async getApiKeyAttribution(
    orgId: string,
    options: { startDate?: Date; endDate?: Date; projectId?: string; limit: number; offset: number }
  ) {
    const records = await this.repository.getApiKeyAttribution(orgId, options);
    return { success: true, data: records };
  }
}

export const usageService = new UsageService();
