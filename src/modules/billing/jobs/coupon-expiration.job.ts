import { billingJobDefinitions } from './definitions.js';

export const couponExpirationJob = billingJobDefinitions.find((job) => job.key === 'couponExpiration');
