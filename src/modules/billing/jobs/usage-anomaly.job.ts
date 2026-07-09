import { billingJobDefinitions } from './definitions.js';

export const usageAnomalyJob = billingJobDefinitions.find((job) => job.key === 'usageAnomaly');
