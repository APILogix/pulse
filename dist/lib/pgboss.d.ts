import { PgBoss } from 'pg-boss';
/**
 * Enterprise PgBoss Singleton.
 * Uses its own connection pool so queue publishing cannot exhaust the primary
 * application query pool. API replicas run producer-only; worker processes own
 * scheduling, supervision, and job execution.
 */
export declare const pgboss: PgBoss;
/** Starts pg-boss once even when multiple modules request it concurrently. */
export declare function startPgBoss(): Promise<void>;
/** Gracefully shuts down pg-boss without exceeding the process drain budget. */
export declare function stopPgBoss(timeout?: number): Promise<void>;
//# sourceMappingURL=pgboss.d.ts.map