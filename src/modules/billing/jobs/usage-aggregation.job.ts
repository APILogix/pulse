import { billingJobDefinitions } from './definitions.js';

export const usageAggregationJob = billingJobDefinitions.find((job) => job.key === 'usageAggregation');
