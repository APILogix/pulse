import { billingJobDefinitions } from './definitions.js';

export const partitionCleanupJob = billingJobDefinitions.find((job) => job.key === 'partitionCleanup');
