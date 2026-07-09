import { billingJobDefinitions } from './definitions.js';

export const invoiceReminderJob = billingJobDefinitions.find((job) => job.key === 'invoiceReminder');
