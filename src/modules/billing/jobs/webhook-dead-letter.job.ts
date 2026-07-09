import { billingJobDefinitions } from './definitions.js';

export const webhookDeadLetterJob = billingJobDefinitions.find((job) => job.key === 'webhookDeadLetter');
