/**
 * Billing background scheduler.
 *
 * Runs lightweight interval jobs for:
 * - invoice cycle generation
 * - overdue invoice dunning transitions
 * - usage rollup snapshots
 * - webhook reconciliation retries
 */
import type { Pool } from 'pg';
export declare function startBillingWorker(pool: Pool): void;
export declare function stopBillingWorker(): void;
//# sourceMappingURL=billing.processor.d.ts.map