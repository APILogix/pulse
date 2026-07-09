import { billingJobDefinitions } from './definitions.js';

export const addonExpirationJob = billingJobDefinitions.find((job) => job.key === 'addonExpiration');
