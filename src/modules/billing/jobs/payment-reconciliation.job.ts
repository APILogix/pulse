import { billingJobDefinitions } from './definitions.js';

export const paymentReconciliationJob = billingJobDefinitions.find((job) => job.key === 'paymentReconciliation');
