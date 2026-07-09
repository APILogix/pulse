import { billingJobDefinitions } from './definitions.js';

export const subscriptionRenewalJob = billingJobDefinitions.find((job) => job.key === 'subscriptionRenewal');
