import { billingJobDefinitions } from './definitions.js';

export const aiCreditResetJob = billingJobDefinitions.find((job) => job.key === 'aiCreditReset');
