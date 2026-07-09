import { billingJobDefinitions } from './definitions.js';

export const billingMetricsJob = billingJobDefinitions.find((job) => job.key === 'billingMetrics');
