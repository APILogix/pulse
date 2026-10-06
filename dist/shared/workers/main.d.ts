/**
 * Worker process bootstrap (Supabase PostgreSQL pgmq - no BullMQ/Redis/pg-boss).
 *
 * Flow:
 * 1. Open a dedicated Postgres pool for background work.
 * 2. Start Supabase PGMQ background workers (alerting, billing, connectors, auth,
 *    analytics, org cleanup) plus the telemetry maintenance worker.
 * 3. Keep the process alive until SIGTERM/SIGINT, then drain + close cleanly.
 *
 * Scale horizontally by running multiple copies of this process. Visibility timeout
 * makes that safe.
 */
import '../../config/dns.js';
//# sourceMappingURL=main.d.ts.map