// quota-service.ts - Quota Management Service

import { BillingRepository } from './repository.js';
import {
  UsageMetricType,
  ServiceResponse,
  PlanLimits
} from './types.js';
import {
  checkLimitExceeded,
  projectUsage,
  addDays,
  daysBetween,
  createBillingLogger,
  BillingError,
  BillingErrorCodes
} from './utils.js';

const logger = createBillingLogger('QuotaService');

export class QuotaService {
  private repository: BillingRepository;

  constructor(repository: BillingRepository) {
    this.repository = repository;
  }

  async checkQuota(
    orgId: string,
    metricType: UsageMetricType,
    requestedAmount: number = 1
  ): Promise<ServiceResponse<{ allowed: boolean; current: number; limit: number | null; remaining: number }>> {
    try {
      const billing = await this.repository.getOrganizationBilling(orgId);
      if (!billing) {
        throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
      }

      const plan = await this.repository.getPlanById(billing.planId);
      if (!plan) {
        throw new BillingError(BillingErrorCodes.PLAN_NOT_FOUND, 'Plan not found', 404);
      }

      const counter = await this.repository.getUsageCounter(orgId);
      const limit = this.getLimitFromPlan(plan.limits, metricType);
      
      let current = 0;
      switch (metricType) {
        case UsageMetricType.API_REQUESTS:
          current = counter?.apiRequestsThisPeriod || 0;
          break;
        case UsageMetricType.METRICS_INGESTED:
          current = counter?.metricsIngestedThisPeriod || 0;
          break;
        case UsageMetricType.STORAGE_GB:
          current = counter?.storageGbThisPeriod || 0;
          break;
        case UsageMetricType.ALERT_NOTIFICATIONS:
          current = counter?.notificationsSentThisPeriod || 0;
          break;
      }

      const check = checkLimitExceeded(current + requestedAmount, limit);
      
      return {
        success: true,
        data: {
          allowed: !check.exceeded,
          current,
          limit,
          remaining: check.remaining
        }
      };
    } catch (error) {
      if (error instanceof BillingError) throw error;
      logger.error('Failed to check quota', error);
      throw new BillingError(BillingErrorCodes.BILLING_ERROR, 'Failed to check quota', 500);
    }
  }

  async incrementUsage(
    orgId: string,
    metricType: UsageMetricType,
    amount: number = 1
  ): Promise<ServiceResponse<{ newTotal: number }>> {
    try {
      const counter = await this.repository.getUsageCounter(orgId);
      let newTotal = amount;

      if (counter) {
        switch (metricType) {
          case UsageMetricType.API_REQUESTS:
            newTotal = counter.apiRequestsThisPeriod + amount;
            break;
          case UsageMetricType.METRICS_INGESTED:
            newTotal = counter.metricsIngestedThisPeriod + amount;
            break;
          case UsageMetricType.STORAGE_GB:
            newTotal = counter.storageGbThisPeriod + amount;
            break;
          case UsageMetricType.ALERT_NOTIFICATIONS:
            newTotal = counter.notificationsSentThisPeriod + amount;
            break;
        }
      }

      return {
        success: true,
        data: { newTotal }
      };
    } catch (error) {
      logger.error('Failed to increment usage', error);
      throw new BillingError(BillingErrorCodes.BILLING_ERROR, 'Failed to increment usage', 500);
    }
  }

  async getUsageReport(orgId: string): Promise<ServiceResponse<any>> {
    try {
      const billing = await this.repository.getOrganizationBilling(orgId);
      const plan = billing ? await this.repository.getPlanById(billing.planId) : null;
      const counter = await this.repository.getUsageCounter(orgId);

      if (!billing || !plan) {
        throw new BillingError(BillingErrorCodes.SUBSCRIPTION_NOT_FOUND, 'No subscription found', 404);
      }

      const now = new Date();
      const daysElapsed = Math.max(1, daysBetween(billing.currentPeriodStart, now));
      const daysInPeriod = daysBetween(billing.currentPeriodStart, billing.currentPeriodEnd);

      const metrics = [
        {
          type: UsageMetricType.API_REQUESTS,
          name: 'API Requests',
          used: counter?.apiRequestsThisPeriod || 0,
          limit: plan.limits.apiRequestsPerMin * 60 * 24 * 30,
          projected: 0
        },
        {
          type: UsageMetricType.METRICS_INGESTED,
          name: 'Metrics Ingested',
          used: counter?.metricsIngestedThisPeriod || 0,
          limit: null,
          projected: 0
        },
        {
          type: UsageMetricType.STORAGE_GB,
          name: 'Storage (GB)',
          used: counter?.storageGbThisPeriod || 0,
          limit: null,
          projected: 0
        },
        {
          type: UsageMetricType.ALERT_NOTIFICATIONS,
          name: 'Alert Notifications',
          used: counter?.notificationsSentThisPeriod || 0,
          limit: null,
          projected: 0
        }
      ];

      metrics.forEach(metric => {
        metric.projected = projectUsage(metric.used, daysElapsed, daysInPeriod);
      });

      return {
        success: true,
        data: {
          orgId,
          periodStart: billing.currentPeriodStart,
          periodEnd: billing.currentPeriodEnd,
          plan: plan.name,
          metrics,
          daysElapsed,
          daysInPeriod
        }
      };
    } catch (error) {
      if (error instanceof BillingError) throw error;
      logger.error('Failed to get usage report', error);
      throw new BillingError(BillingErrorCodes.BILLING_ERROR, 'Failed to get usage report', 500);
    }
  }

  private getLimitFromPlan(limits: PlanLimits, metricType: UsageMetricType): number | null {
    switch (metricType) {
      case UsageMetricType.API_REQUESTS:
        return limits.apiRequestsPerMin * 60 * 24 * 30; // Monthly
      case UsageMetricType.METRICS_INGESTED:
        return null;
      case UsageMetricType.STORAGE_GB:
        return null;
      case UsageMetricType.ALERT_NOTIFICATIONS:
        return null;
      case UsageMetricType.PROJECTS_ACTIVE:
        return limits.maxProjects;
      case UsageMetricType.MEMBERS_ACTIVE:
        return limits.maxMembers;
      case UsageMetricType.APPLICATIONS_MONITORED:
        return limits.maxApplications;
      case UsageMetricType.INTEGRATIONS_ACTIVE:
        return limits.integrations;
      default:
        return null;
    }
  }
}