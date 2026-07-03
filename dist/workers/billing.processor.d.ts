export {};
/**
 * Billing worker notes.
 *
 * Billing scheduling now lives in src/modules/billing/queue.ts via pg-boss,
 * consistent with the rest of the platform's Postgres-backed cron jobs.
 *
 * This file remains as a marker for any future non-cron billing processors
 * (for example provider webhook fan-out or heavy invoice-generation workers).
 */
//# sourceMappingURL=billing.processor.d.ts.map