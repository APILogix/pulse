import { billingJobDefinitions } from './definitions.js';

export const billingAuditArchiveJob = billingJobDefinitions.find((job) => job.key === 'billingAuditArchive');
