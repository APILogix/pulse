import { BillingJobsRepository } from './repository.js';
import { BillingJobsService } from './service.js';
import { BILLING_JOB_NAMES } from './types.js';
const service = new BillingJobsService(new BillingJobsRepository());
export const billingJobDefinitions = [
    {
        key: 'subscriptionRenewal',
        name: BILLING_JOB_NAMES.subscriptionRenewal,
        schedule: (config) => config.schedules.subscriptionRenewal,
        run: (context) => service.runSubscriptionRenewal(context),
    },
    {
        key: 'trialExpiration',
        name: BILLING_JOB_NAMES.trialExpiration,
        schedule: (config) => config.schedules.trialExpiration,
        run: (context) => service.runTrialExpiration(context),
    },
    {
        key: 'invoiceGeneration',
        name: BILLING_JOB_NAMES.invoiceGeneration,
        schedule: (config) => config.schedules.invoiceGeneration,
        run: (context) => service.runInvoiceGeneration(context),
    },
    {
        key: 'paymentSync',
        name: BILLING_JOB_NAMES.paymentSync,
        schedule: (config) => config.schedules.paymentSync,
        run: (context) => service.runPaymentSync(context),
    },
    {
        key: 'paymentReconciliation',
        name: BILLING_JOB_NAMES.paymentReconciliation,
        schedule: (config) => config.schedules.paymentReconciliation,
        run: (context) => service.runPaymentReconciliation(context),
    },
    {
        key: 'webhookRetry',
        name: BILLING_JOB_NAMES.webhookRetry,
        schedule: (config) => config.schedules.webhookRetry,
        run: (context) => service.runWebhookRetry(context),
    },
    {
        key: 'webhookDeadLetter',
        name: BILLING_JOB_NAMES.webhookDeadLetter,
        schedule: (config) => config.schedules.webhookDeadLetter,
        run: (context) => service.runWebhookDeadLetter(context),
    },
    {
        key: 'usageRollover',
        name: BILLING_JOB_NAMES.usageRollover,
        schedule: (config) => config.schedules.usageRollover,
        run: (context) => service.runUsageRollover(context),
    },
    {
        key: 'usageAggregation',
        name: BILLING_JOB_NAMES.usageAggregation,
        schedule: (config) => config.schedules.usageAggregation,
        run: (context) => service.runUsageAggregation(context),
    },
    {
        key: 'aiCreditReset',
        name: BILLING_JOB_NAMES.aiCreditReset,
        schedule: (config) => config.schedules.aiCreditReset,
        run: (context) => service.runAiCreditReset(context),
    },
    {
        key: 'couponExpiration',
        name: BILLING_JOB_NAMES.couponExpiration,
        schedule: (config) => config.schedules.couponExpiration,
        run: (context) => service.runCouponExpiration(context),
    },
    {
        key: 'addonExpiration',
        name: BILLING_JOB_NAMES.addonExpiration,
        schedule: (config) => config.schedules.addonExpiration,
        run: (context) => service.runAddonExpiration(context),
    },
    {
        key: 'featureOverrideExpiration',
        name: BILLING_JOB_NAMES.featureOverrideExpiration,
        schedule: (config) => config.schedules.featureOverrideExpiration,
        run: (context) => service.runFeatureOverrideExpiration(context),
    },
    {
        key: 'invoiceReminder',
        name: BILLING_JOB_NAMES.invoiceReminder,
        schedule: (config) => config.schedules.invoiceReminder,
        run: (context) => service.runInvoiceReminder(context),
    },
    {
        key: 'partitionCreator',
        name: BILLING_JOB_NAMES.partitionCreator,
        schedule: (config) => config.schedules.partitionCreator,
        run: (context) => service.runPartitionCreator(context),
    },
    {
        key: 'partitionCleanup',
        name: BILLING_JOB_NAMES.partitionCleanup,
        schedule: (config) => config.schedules.partitionCleanup,
        run: (context) => service.runPartitionCleanup(context),
    },
    {
        key: 'usageAnomaly',
        name: BILLING_JOB_NAMES.usageAnomaly,
        schedule: (config) => config.schedules.usageAnomaly,
        run: (context) => service.runUsageAnomaly(context),
    },
    {
        key: 'entitlementRefresh',
        name: BILLING_JOB_NAMES.entitlementRefresh,
        schedule: (config) => config.schedules.entitlementRefresh,
        run: (context) => service.runEntitlementRefresh(context),
    },
    {
        key: 'billingAuditArchive',
        name: BILLING_JOB_NAMES.billingAuditArchive,
        schedule: (config) => config.schedules.billingAuditArchive,
        run: (context) => service.runBillingAuditArchive(context),
    },
    {
        key: 'dataReconciliation',
        name: BILLING_JOB_NAMES.dataReconciliation,
        schedule: (config) => config.schedules.dataReconciliation,
        run: (context) => service.runDataReconciliation(context),
    },
    {
        key: 'billingMetrics',
        name: BILLING_JOB_NAMES.billingMetrics,
        schedule: (config) => config.schedules.billingMetrics,
        run: (context) => service.runBillingMetrics(context),
    },
];
//# sourceMappingURL=definitions.js.map