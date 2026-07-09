import { billingJobDefinitions } from './definitions.js';

export const webhookRetryJob = billingJobDefinitions.find((job) => job.key === 'webhookRetry');
