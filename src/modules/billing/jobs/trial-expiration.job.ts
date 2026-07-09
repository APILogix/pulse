import { billingJobDefinitions } from './definitions.js';

export const trialExpirationJob = billingJobDefinitions.find((job) => job.key === 'trialExpiration');
