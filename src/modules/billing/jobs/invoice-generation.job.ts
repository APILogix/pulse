import { billingJobDefinitions } from './definitions.js';

export const invoiceGenerationJob = billingJobDefinitions.find((job) => job.key === 'invoiceGeneration');
