/**
 * Auto-resolve sweep.
 *
 * Closes alerts whose `autoResolveAfterMinutes` deadline has passed without the
 * alert being re-asserted. Before this existed, `autoResolveAfterMinutes` was a
 * validated, stored, UI-exposed rule field with NO runtime effect: the decision
 * engine wrote `alert_event_state.auto_resolve_at` and an index existed for a
 * sweep, but nothing ever read it, so a configured auto-resolve never happened.
 *
 * This is a TIMEOUT-based resolution and is deliberately labelled as such
 * (`resolution_reason = 'auto_resolved'`). It does NOT assert that the
 * underlying condition became false - only an evaluated recovery does that. The
 * distinction matters operationally: an auto-resolved alert may still be
 * breaching if the evaluator stopped receiving data for that scope.
 *
 * Runs in the worker process only (never the API process), on a schedule.
 */
import type { FastifyBaseLogger } from 'fastify';
import type { Pool } from 'pg';
import { AlertRuntimeRepository } from './alert-runtime.repository.js';
export interface AutoResolveSweepResult {
    claimed: number;
    resolved: number;
    failed: number;
}
export declare class AlertAutoResolveSweep {
    private readonly runtime;
    private readonly log;
    /** Guards against a slow sweep overlapping itself within one process. */
    private running;
    constructor(logDb: Pool, logger: FastifyBaseLogger, runtime?: AlertRuntimeRepository);
    run(limit?: number): Promise<AutoResolveSweepResult>;
}
//# sourceMappingURL=auto-resolve-sweep.d.ts.map